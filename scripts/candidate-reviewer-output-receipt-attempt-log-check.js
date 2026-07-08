const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const attemptPath = path.join(docsDir, "当前候选交付Reviewer输出接收尝试记录.md");
const fieldGapMatrixPath = path.join(docsDir, "当前候选交付Reviewer输出字段缺口定位矩阵.md");
const assignmentPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复责任分派单.md");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
const returnClosurePath = path.join(docsDir, "当前候选交付Reviewer输出退回与补交闭环记录.md");
const receiptGatePath = path.join(docsDir, "当前候选交付Reviewer输出接收门禁.md");
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
const attempt = fs.readFileSync(attemptPath, "utf8");
const fieldGapMatrix = fs.readFileSync(fieldGapMatrixPath, "utf8");
const assignment = fs.readFileSync(assignmentPath, "utf8");
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const attemptFields = [
  "receiptAttemptId",
  "sourceReturnClosureId",
  "sourceResubmissionPackageRef",
  "sourceReviewerOutputBundleRef",
  "attemptNumber",
  "attemptedAt",
  "attemptedBy",
  "reviewerName",
  "reviewerRole",
  "affectedEvidenceSlots",
  "receiptCommand",
  "precheckStatus",
  "missingFieldCount",
  "placeholderCount",
  "conflictCount",
  "riskFollowupGapCount",
  "attemptResult",
  "receiptGateDecisionRef",
  "rejectionReasonType",
  "rejectionReasonSummary",
  "returnClosureRequired",
  "nextReturnClosureRef",
  "readyForSummary",
  "nextAction",
];

const precheckStatuses = [
  "not-run",
  "ready-to-run",
  "blocked-by-open-return",
  "blocked-by-missing-resubmission",
  "blocked-by-open-clarification",
  "cancelled",
];

const attemptResults = [
  "attempt-recorded",
  "receipt-gate-passed",
  "receipt-gate-failed",
  "returned-for-fix",
  "retry-required",
  "cancelled",
];

const rejectionReasonTypes = [
  "missing-required-field",
  "placeholder-detected",
  "missing-evidence-slot",
  "unclear-evidence-ref",
  "conflicting-disposition",
  "missing-risk-followup",
  "out-of-scope-output",
  "wrong-reviewer-role",
  "open-return-closure",
  "open-clarification",
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
  "npm.cmd run candidate:reviewer-output-receipt-attempt-log-check",
  "npm.cmd run candidate:reviewer-output-field-gap-matrix-check",
  "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
  "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
  "npm.cmd run candidate:reviewer-output-return-resubmission-closure-check",
  "npm.cmd run candidate:reviewer-output-receipt-check",
  "npm.cmd run candidate:reviewer-in-review-blocker-clarification-check",
  "npm.cmd run candidate:reviewer-review-start-confirmation-check",
  "npm.cmd run candidate:final-review-package-lock-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
];

assert("candidate reviewer output receipt attempt log check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output receipt attempt log check command",
  packageJson.scripts["candidate:reviewer-output-receipt-attempt-log-check"] ===
    "node scripts/candidate-reviewer-output-receipt-attempt-log-check.js"
);
assert(
  "check pipeline includes candidate reviewer output receipt attempt log check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-receipt-attempt-log-check.js")
);
assert("reviewer output receipt attempt log exists", fs.existsSync(attemptPath));
assert("reviewer output receipt attempt log is log-only", attempt.includes("reviewer-output-receipt-attempt-log-only"));
assert(
  "reviewer output receipt attempt log preserves candidate state",
  attempt.includes("APP_VERSION=1.9.48") &&
    attempt.includes("PHASE=29") &&
    attempt.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output receipt attempt log keeps gates blocked",
  attempt.includes("releaseReady=false") &&
    attempt.includes("phase29ExitReady=false") &&
    attempt.includes("phase30EntryReady=false") &&
    attempt.includes("runtimeExecution=false") &&
    attempt.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output receipt attempt log records missing evidence state",
  attempt.includes("liveSubmissionExists=false") &&
    attempt.includes("approvedSlots=0") &&
    attempt.includes("missingSlots=10")
);
assert(
  "reviewer output receipt attempt log blocks conversion by default",
  attempt.includes("maintainerConversionAuthorization=false") &&
    attempt.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output receipt attempt log lists fields", attemptFields.every((field) => attempt.includes(field)));
assert("reviewer output receipt attempt log lists precheck statuses", precheckStatuses.every((status) => attempt.includes(status)));
assert("reviewer output receipt attempt log lists attempt results", attemptResults.every((result) => attempt.includes(result)));
assert("reviewer output receipt attempt log lists rejection reason types", rejectionReasonTypes.every((reasonType) => attempt.includes(reasonType)));
assert("reviewer output receipt attempt log covers reviewer roles", reviewerRoles.every((role) => attempt.includes(role)));
assert("reviewer output receipt attempt log covers all slots", requiredSlots.every((slot) => attempt.includes(slot)));
assert("reviewer output receipt attempt log keeps reviewer fields external", requiredReviewerFields.every((field) => attempt.includes(field)));
assert("reviewer output receipt attempt log requires followup fields", followupFields.every((field) => attempt.includes(field)));
assert("reviewer output receipt attempt log includes command checks", commands.every((command) => attempt.includes(command)));
assert(
  "reviewer output receipt attempt log protects live submission conversion",
  attempt.includes("data/phase30-human-evidence-submission.json") &&
    attempt.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output receipt attempt log says attempt is not receipt acceptance",
  attempt.includes("attempt-recorded") &&
    attempt.includes("retry-required") &&
    attempt.includes("不是 reviewer 输出") &&
    attempt.includes("不是 Reviewer 输出接收门禁通过")
);
assert("reviewer output receipt attempt log links return resubmission closure record", attempt.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("reviewer output receipt attempt log links field gap matrix", attempt.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("reviewer output field gap matrix links receipt attempt log", fieldGapMatrix.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("reviewer output receipt attempt log links field fix assignment", attempt.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("reviewer output field fix assignment links receipt attempt log", assignment.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("reviewer output receipt attempt log links field fix receipt retry readiness", attempt.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("reviewer output field fix receipt retry readiness links receipt attempt log", receiptReadiness.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("reviewer output receipt attempt log links output receipt gate", attempt.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("return resubmission closure record links receipt attempt log", returnClosure.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("output receipt gate links receipt attempt log", receiptGate.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("pre-review package links receipt attempt log", preReview.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("review execution sequence links receipt attempt log", sequence.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("review chain integrity index links receipt attempt log", integrity.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("negative misuse check links receipt attempt log", negative.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("final review package lock index links receipt attempt log", finalLock.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert(
  "README links reviewer output receipt attempt log",
  readme.includes("Current candidate reviewer output receipt attempt log") &&
    readme.includes("项目文档/当前候选交付Reviewer输出接收尝试记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output receipt attempt log checks passed.");
