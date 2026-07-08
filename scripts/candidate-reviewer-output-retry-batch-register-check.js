const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const retryBatchPath = path.join(docsDir, "当前候选交付Reviewer输出重试批次登记表.md");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
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
const retryBatch = fs.readFileSync(retryBatchPath, "utf8");
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
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

const retryBatchFields = [
  "retryBatchId",
  "sourceFieldFixReceiptIds",
  "sourceRetryReadinessStatus",
  "sourceReceiptAttemptIds",
  "sourceReviewerOutputBundleRefs",
  "reviewerNames",
  "reviewerRoles",
  "affectedEvidenceSlots",
  "affectedFieldNames",
  "gapTypes",
  "blockingSeverities",
  "resubmissionPackageRefs",
  "batchOwner",
  "batchCreatedAt",
  "batchCreatedBy",
  "batchStatus",
  "batchPrecheckStatus",
  "receiptAttemptCommand",
  "targetReceiptAttemptId",
  "targetReceiptGateRef",
  "retryWindow",
  "rollbackRequiredIfFailed",
  "rollbackTarget",
  "failureRoute",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const sourceRetryReadinessStatuses = [
  "ready-for-receipt-attempt",
  "ready-for-return-closure",
  "blocked-by-open-gap",
  "blocked-by-missing-package",
  "cancelled",
];

const batchStatuses = [
  "draft",
  "ready-for-receipt-attempt",
  "queued-for-receipt-attempt",
  "attempt-recorded",
  "blocked-by-open-gap",
  "blocked-by-missing-package",
  "cancelled",
];

const batchPrecheckStatuses = [
  "not-run",
  "ready-to-run",
  "blocked-by-missing-receipt-readiness",
  "blocked-by-open-return",
  "blocked-by-open-clarification",
  "blocked-by-missing-resubmission",
  "cancelled",
];

const failureRoutes = [
  "return-to-field-gap-matrix",
  "return-to-field-fix-assignment",
  "return-to-return-resubmission-closure",
  "return-to-receipt-attempt-log",
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
  "npm.cmd run candidate:reviewer-output-retry-batch-register-check",
  "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
  "npm.cmd run candidate:reviewer-output-receipt-attempt-log-check",
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

assert("candidate reviewer output retry batch register check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output retry batch register check command",
  packageJson.scripts["candidate:reviewer-output-retry-batch-register-check"] ===
    "node scripts/candidate-reviewer-output-retry-batch-register-check.js"
);
assert(
  "check pipeline includes candidate reviewer output retry batch register check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-retry-batch-register-check.js")
);
assert("reviewer output retry batch register exists", fs.existsSync(retryBatchPath));
assert("reviewer output retry batch register is register-only", retryBatch.includes("reviewer-output-retry-batch-register-only"));
assert(
  "reviewer output retry batch register preserves candidate state",
  retryBatch.includes("APP_VERSION=1.9.48") &&
    retryBatch.includes("PHASE=29") &&
    retryBatch.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output retry batch register keeps gates blocked",
  retryBatch.includes("releaseReady=false") &&
    retryBatch.includes("phase29ExitReady=false") &&
    retryBatch.includes("phase30EntryReady=false") &&
    retryBatch.includes("runtimeExecution=false") &&
    retryBatch.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output retry batch register records missing evidence state",
  retryBatch.includes("liveSubmissionExists=false") &&
    retryBatch.includes("approvedSlots=0") &&
    retryBatch.includes("missingSlots=10")
);
assert(
  "reviewer output retry batch register blocks conversion by default",
  retryBatch.includes("maintainerConversionAuthorization=false") &&
    retryBatch.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output retry batch register lists fields", retryBatchFields.every((field) => retryBatch.includes(field)));
assert("reviewer output retry batch register lists source retry statuses", sourceRetryReadinessStatuses.every((status) => retryBatch.includes(status)));
assert("reviewer output retry batch register lists batch statuses", batchStatuses.every((status) => retryBatch.includes(status)));
assert("reviewer output retry batch register lists precheck statuses", batchPrecheckStatuses.every((status) => retryBatch.includes(status)));
assert("reviewer output retry batch register lists failure routes", failureRoutes.every((route) => retryBatch.includes(route)));
assert("reviewer output retry batch register covers reviewer roles", reviewerRoles.every((role) => retryBatch.includes(role)));
assert("reviewer output retry batch register covers all slots", requiredSlots.every((slot) => retryBatch.includes(slot)));
assert("reviewer output retry batch register keeps reviewer fields external", requiredReviewerFields.every((field) => retryBatch.includes(field)));
assert("reviewer output retry batch register requires followup fields", followupFields.every((field) => retryBatch.includes(field)));
assert("reviewer output retry batch register includes command checks", commands.every((command) => retryBatch.includes(command)));
assert(
  "reviewer output retry batch register protects live submission conversion",
  retryBatch.includes("data/phase30-human-evidence-submission.json") &&
    retryBatch.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output retry batch register says it is not receipt acceptance",
  retryBatch.includes("不是 reviewer 输出") &&
    retryBatch.includes("不是字段已修复证明") &&
    retryBatch.includes("不是 Reviewer 输出接收门禁通过") &&
    retryBatch.includes("不是 evidence acceptance")
);
assert(
  "reviewer output retry batch register routes through attempt and gate",
  retryBatch.includes("当前候选交付Reviewer输出接收尝试记录.md") &&
    retryBatch.includes("当前候选交付Reviewer输出接收门禁.md") &&
    retryBatch.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md")
);
assert(
  "reviewer output retry batch register rejects false batch meanings",
  retryBatch.includes("ready-for-receipt-attempt") &&
    retryBatch.includes("不表示接收门禁通过") &&
    retryBatch.includes("queued-for-receipt-attempt") &&
    retryBatch.includes("不得触发接收尝试")
);
assert("reviewer output retry batch register links field fix receipt retry readiness", retryBatch.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("field fix receipt retry readiness links retry batch register", receiptReadiness.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("receipt attempt log links retry batch register", attempt.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("output receipt gate links retry batch register", receiptGate.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("field gap matrix links retry batch register", fieldGapMatrix.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("field fix assignment links retry batch register", assignment.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("return resubmission closure record links retry batch register", returnClosure.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("pre-review package links retry batch register", preReview.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("review execution sequence links retry batch register", sequence.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("review chain integrity index links retry batch register", integrity.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("negative misuse check links retry batch register", negative.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("final review package lock index links retry batch register", finalLock.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert(
  "README links reviewer output retry batch register",
  readme.includes("Current candidate reviewer output retry batch register") &&
    readme.includes("项目文档/当前候选交付Reviewer输出重试批次登记表.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output retry batch register checks passed.");
