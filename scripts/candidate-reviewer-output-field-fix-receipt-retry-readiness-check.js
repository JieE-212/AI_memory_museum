const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
const assignmentPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复责任分派单.md");
const matrixPath = path.join(docsDir, "当前候选交付Reviewer输出字段缺口定位矩阵.md");
const attemptPath = path.join(docsDir, "当前候选交付Reviewer输出接收尝试记录.md");
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
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
const assignment = fs.readFileSync(assignmentPath, "utf8");
const matrix = fs.readFileSync(matrixPath, "utf8");
const attempt = fs.readFileSync(attemptPath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const receiptReadinessFields = [
  "fieldFixReceiptId",
  "sourceFieldFixAssignmentId",
  "sourceFieldGapMatrixId",
  "sourceReceiptAttemptId",
  "sourceReviewerOutputBundleRef",
  "reviewerName",
  "reviewerRole",
  "evidenceSlot",
  "fieldName",
  "gapType",
  "blockingSeverity",
  "targetFixOwner",
  "fixRoute",
  "fixReceiptStatus",
  "fixReceiptReceivedAt",
  "fixReceiptReceivedBy",
  "fixReceiptRef",
  "resubmissionPackageRef",
  "resubmissionPackageReceivedAt",
  "resubmissionCompletenessStatus",
  "retryReadinessStatus",
  "returnClosureRequired",
  "returnClosureRef",
  "nextReceiptAttemptRequired",
  "nextReceiptAttemptCommand",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const fixReceiptStatuses = [
  "not-received",
  "received",
  "received-with-gap",
  "rejected-as-incomplete",
  "cancelled",
];

const resubmissionCompletenessStatuses = [
  "not-submitted",
  "package-received",
  "missing-required-ref",
  "missing-required-field",
  "placeholder-still-present",
  "ready-for-return-closure",
];

const retryReadinessStatuses = [
  "not-ready",
  "ready-for-return-closure",
  "ready-for-receipt-attempt",
  "blocked-by-open-gap",
  "blocked-by-missing-package",
  "cancelled",
];

const gapTypes = [
  "missing-required-field",
  "placeholder-detected",
  "invalid-reviewedAt",
  "invalid-evidenceRef",
  "invalid-disposition",
  "missing-risk-followup",
  "conflicting-field",
  "wrong-reviewer-role",
];

const blockingSeverities = [
  "block-receipt",
  "return-for-fix",
  "needs-clarification",
  "non-blocking-note",
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
  "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
  "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
  "npm.cmd run candidate:reviewer-output-field-gap-matrix-check",
  "npm.cmd run candidate:reviewer-output-receipt-attempt-log-check",
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

assert("candidate reviewer output field fix receipt retry readiness check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output field fix receipt retry readiness check command",
  packageJson.scripts["candidate:reviewer-output-field-fix-receipt-retry-readiness-check"] ===
    "node scripts/candidate-reviewer-output-field-fix-receipt-retry-readiness-check.js"
);
assert(
  "check pipeline includes candidate reviewer output field fix receipt retry readiness check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-field-fix-receipt-retry-readiness-check.js")
);
assert("reviewer output field fix receipt retry readiness exists", fs.existsSync(receiptReadinessPath));
assert(
  "reviewer output field fix receipt retry readiness is readiness-only",
  receiptReadiness.includes("reviewer-output-field-fix-receipt-retry-readiness-only")
);
assert(
  "reviewer output field fix receipt retry readiness preserves candidate state",
  receiptReadiness.includes("APP_VERSION=1.9.48") &&
    receiptReadiness.includes("PHASE=29") &&
    receiptReadiness.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output field fix receipt retry readiness keeps gates blocked",
  receiptReadiness.includes("releaseReady=false") &&
    receiptReadiness.includes("phase29ExitReady=false") &&
    receiptReadiness.includes("phase30EntryReady=false") &&
    receiptReadiness.includes("runtimeExecution=false") &&
    receiptReadiness.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output field fix receipt retry readiness records missing evidence state",
  receiptReadiness.includes("liveSubmissionExists=false") &&
    receiptReadiness.includes("approvedSlots=0") &&
    receiptReadiness.includes("missingSlots=10")
);
assert(
  "reviewer output field fix receipt retry readiness blocks conversion by default",
  receiptReadiness.includes("maintainerConversionAuthorization=false") &&
    receiptReadiness.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output field fix receipt retry readiness lists fields", receiptReadinessFields.every((field) => receiptReadiness.includes(field)));
assert("reviewer output field fix receipt retry readiness lists receipt statuses", fixReceiptStatuses.every((status) => receiptReadiness.includes(status)));
assert("reviewer output field fix receipt retry readiness lists completeness statuses", resubmissionCompletenessStatuses.every((status) => receiptReadiness.includes(status)));
assert("reviewer output field fix receipt retry readiness lists retry statuses", retryReadinessStatuses.every((status) => receiptReadiness.includes(status)));
assert("reviewer output field fix receipt retry readiness lists gap types", gapTypes.every((gapType) => receiptReadiness.includes(gapType)));
assert("reviewer output field fix receipt retry readiness lists blocking severities", blockingSeverities.every((severity) => receiptReadiness.includes(severity)));
assert("reviewer output field fix receipt retry readiness covers reviewer roles", reviewerRoles.every((role) => receiptReadiness.includes(role)));
assert("reviewer output field fix receipt retry readiness covers all slots", requiredSlots.every((slot) => receiptReadiness.includes(slot)));
assert("reviewer output field fix receipt retry readiness keeps reviewer fields external", requiredReviewerFields.every((field) => receiptReadiness.includes(field)));
assert("reviewer output field fix receipt retry readiness requires followup fields", followupFields.every((field) => receiptReadiness.includes(field)));
assert("reviewer output field fix receipt retry readiness includes command checks", commands.every((command) => receiptReadiness.includes(command)));
assert(
  "reviewer output field fix receipt retry readiness protects live submission conversion",
  receiptReadiness.includes("data/phase30-human-evidence-submission.json") &&
    receiptReadiness.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output field fix receipt retry readiness says it is not fix proof or receipt acceptance",
  receiptReadiness.includes("不是字段已修复证明") &&
    receiptReadiness.includes("不是 Reviewer 输出接收门禁通过") &&
    receiptReadiness.includes("不是 evidence acceptance")
);
assert(
  "reviewer output field fix receipt retry readiness routes through attempt and gate",
  receiptReadiness.includes("当前候选交付Reviewer输出退回与补交闭环记录.md") &&
    receiptReadiness.includes("当前候选交付Reviewer输出接收尝试记录.md") &&
    receiptReadiness.includes("当前候选交付Reviewer输出接收门禁.md")
);
assert(
  "reviewer output field fix receipt retry readiness rejects false status meanings",
  receiptReadiness.includes("received") &&
    receiptReadiness.includes("不表示字段已修复") &&
    receiptReadiness.includes("ready-for-receipt-attempt") &&
    receiptReadiness.includes("不得跳过接收门禁")
);
assert("reviewer output field fix receipt retry readiness links field fix assignment", receiptReadiness.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("field fix assignment links field fix receipt retry readiness", assignment.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("field gap matrix links field fix receipt retry readiness", matrix.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("receipt attempt log links field fix receipt retry readiness", attempt.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("return resubmission closure record links field fix receipt retry readiness", returnClosure.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("output receipt gate links field fix receipt retry readiness", receiptGate.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("pre-review package links field fix receipt retry readiness", preReview.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("review execution sequence links field fix receipt retry readiness", sequence.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("review chain integrity index links field fix receipt retry readiness", integrity.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("negative misuse check links field fix receipt retry readiness", negative.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("final review package lock index links field fix receipt retry readiness", finalLock.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert(
  "README links reviewer output field fix receipt retry readiness",
  readme.includes("Current candidate reviewer output field fix receipt retry readiness") &&
    readme.includes("项目文档/当前候选交付Reviewer输出字段修复回执与重试准备记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output field fix receipt retry readiness checks passed.");
