const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const assignmentPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复责任分派单.md");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
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
const assignment = fs.readFileSync(assignmentPath, "utf8");
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
const matrix = fs.readFileSync(matrixPath, "utf8");
const attempt = fs.readFileSync(attemptPath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const assignmentFields = [
  "fieldFixAssignmentId",
  "sourceFieldGapMatrixId",
  "sourceReceiptAttemptId",
  "sourceReviewerOutputBundleRef",
  "reviewerName",
  "reviewerRole",
  "evidenceSlot",
  "fieldName",
  "gapType",
  "blockingSeverity",
  "assignmentStatus",
  "assignedBy",
  "assignedAt",
  "targetFixOwner",
  "targetFixDueAt",
  "requestedFix",
  "requiredReplacementValueRule",
  "fixRoute",
  "returnClosureRequired",
  "returnClosureRef",
  "clarificationRequired",
  "resubmissionPackageRef",
  "receiptRetryRequired",
  "receiptRetryCommand",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const assignmentStatuses = [
  "drafted",
  "assigned",
  "acknowledged",
  "in-progress",
  "fix-submitted",
  "ready-for-return-closure",
  "cancelled",
];

const fixRoutes = [
  "return-to-reviewer",
  "maintainer-clarification",
  "evidence-ref-replacement",
  "risk-followup-completion",
  "role-correction",
  "no-fix-needed",
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

const commands = [
  "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
  "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
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

assert("candidate reviewer output field fix assignment check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output field fix assignment check command",
  packageJson.scripts["candidate:reviewer-output-field-fix-assignment-check"] ===
    "node scripts/candidate-reviewer-output-field-fix-assignment-check.js"
);
assert(
  "check pipeline includes candidate reviewer output field fix assignment check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-field-fix-assignment-check.js")
);
assert("reviewer output field fix assignment exists", fs.existsSync(assignmentPath));
assert("reviewer output field fix assignment is assignment-only", assignment.includes("reviewer-output-field-fix-assignment-only"));
assert(
  "reviewer output field fix assignment preserves candidate state",
  assignment.includes("APP_VERSION=1.9.48") &&
    assignment.includes("PHASE=29") &&
    assignment.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output field fix assignment keeps gates blocked",
  assignment.includes("releaseReady=false") &&
    assignment.includes("phase29ExitReady=false") &&
    assignment.includes("phase30EntryReady=false") &&
    assignment.includes("runtimeExecution=false") &&
    assignment.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output field fix assignment records missing evidence state",
  assignment.includes("liveSubmissionExists=false") &&
    assignment.includes("approvedSlots=0") &&
    assignment.includes("missingSlots=10")
);
assert(
  "reviewer output field fix assignment blocks conversion by default",
  assignment.includes("maintainerConversionAuthorization=false") &&
    assignment.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output field fix assignment lists fields", assignmentFields.every((field) => assignment.includes(field)));
assert("reviewer output field fix assignment lists statuses", assignmentStatuses.every((status) => assignment.includes(status)));
assert("reviewer output field fix assignment lists fix routes", fixRoutes.every((route) => assignment.includes(route)));
assert("reviewer output field fix assignment lists gap types", gapTypes.every((gapType) => assignment.includes(gapType)));
assert("reviewer output field fix assignment lists blocking severities", blockingSeverities.every((severity) => assignment.includes(severity)));
assert("reviewer output field fix assignment covers reviewer roles", reviewerRoles.every((role) => assignment.includes(role)));
assert("reviewer output field fix assignment covers all slots", requiredSlots.every((slot) => assignment.includes(slot)));
assert("reviewer output field fix assignment keeps reviewer fields external", requiredReviewerFields.every((field) => assignment.includes(field)));
assert("reviewer output field fix assignment requires followup fields", followupFields.every((field) => assignment.includes(field)));
assert("reviewer output field fix assignment includes command checks", commands.every((command) => assignment.includes(command)));
assert(
  "reviewer output field fix assignment protects live submission conversion",
  assignment.includes("data/phase30-human-evidence-submission.json") &&
    assignment.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output field fix assignment says it is not a fix or receipt",
  assignment.includes("不是字段已修复证明") &&
    assignment.includes("不是 Reviewer 输出接收门禁通过") &&
    assignment.includes("不是 evidence acceptance")
);
assert(
  "reviewer output field fix assignment routes through closure and gate",
  assignment.includes("当前候选交付Reviewer输出退回与补交闭环记录.md") &&
    assignment.includes("当前候选交付Reviewer输出接收尝试记录.md") &&
    assignment.includes("当前候选交付Reviewer输出接收门禁.md")
);
assert(
  "reviewer output field fix assignment rejects false status meanings",
  assignment.includes("assigned") &&
    assignment.includes("不表示修复已发出") &&
    assignment.includes("fix-submitted") &&
    assignment.includes("仍不是 Reviewer 输出接收门禁通过")
);
assert("reviewer output field fix assignment links field gap matrix", assignment.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("reviewer output field fix assignment links field fix receipt retry readiness", assignment.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("reviewer output field fix receipt retry readiness links field fix assignment", receiptReadiness.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("field gap matrix links field fix assignment", matrix.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("receipt attempt log links field fix assignment", attempt.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("return resubmission closure record links field fix assignment", returnClosure.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("output receipt gate links field fix assignment", receiptGate.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("pre-review package links field fix assignment", preReview.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("review execution sequence links field fix assignment", sequence.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("review chain integrity index links field fix assignment", integrity.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("negative misuse check links field fix assignment", negative.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("final review package lock index links field fix assignment", finalLock.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert(
  "README links reviewer output field fix assignment",
  readme.includes("Current candidate reviewer output field fix assignment") &&
    readme.includes("项目文档/当前候选交付Reviewer输出字段修复责任分派单.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output field fix assignment checks passed.");
