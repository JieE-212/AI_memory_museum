const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const matrixPath = path.join(docsDir, "当前候选交付Reviewer输出字段缺口定位矩阵.md");
const assignmentPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复责任分派单.md");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
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
const matrix = fs.readFileSync(matrixPath, "utf8");
const assignment = fs.readFileSync(assignmentPath, "utf8");
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
const attempt = fs.readFileSync(attemptPath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const matrixFields = [
  "fieldGapMatrixId",
  "sourceReceiptAttemptId",
  "sourceReviewerOutputBundleRef",
  "reviewerName",
  "reviewerRole",
  "evidenceSlot",
  "fieldName",
  "fieldStatus",
  "gapType",
  "observedValue",
  "expectedRule",
  "blockingSeverity",
  "returnClosureRequired",
  "targetFixOwner",
  "targetFixDueAt",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const fieldStatuses = [
  "present",
  "missing",
  "placeholder",
  "invalid-format",
  "conflicting",
  "not-applicable",
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
  "npm.cmd run candidate:reviewer-output-field-gap-matrix-check",
  "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
  "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
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

assert("candidate reviewer output field gap matrix check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output field gap matrix check command",
  packageJson.scripts["candidate:reviewer-output-field-gap-matrix-check"] ===
    "node scripts/candidate-reviewer-output-field-gap-matrix-check.js"
);
assert(
  "check pipeline includes candidate reviewer output field gap matrix check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-field-gap-matrix-check.js")
);
assert("reviewer output field gap matrix exists", fs.existsSync(matrixPath));
assert("reviewer output field gap matrix is matrix-only", matrix.includes("reviewer-output-field-gap-matrix-only"));
assert(
  "reviewer output field gap matrix preserves candidate state",
  matrix.includes("APP_VERSION=1.9.48") &&
    matrix.includes("PHASE=29") &&
    matrix.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output field gap matrix keeps gates blocked",
  matrix.includes("releaseReady=false") &&
    matrix.includes("phase29ExitReady=false") &&
    matrix.includes("phase30EntryReady=false") &&
    matrix.includes("runtimeExecution=false") &&
    matrix.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output field gap matrix records missing evidence state",
  matrix.includes("liveSubmissionExists=false") &&
    matrix.includes("approvedSlots=0") &&
    matrix.includes("missingSlots=10")
);
assert(
  "reviewer output field gap matrix blocks conversion by default",
  matrix.includes("maintainerConversionAuthorization=false") &&
    matrix.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output field gap matrix lists fields", matrixFields.every((field) => matrix.includes(field)));
assert("reviewer output field gap matrix lists field statuses", fieldStatuses.every((status) => matrix.includes(status)));
assert("reviewer output field gap matrix lists gap types", gapTypes.every((gapType) => matrix.includes(gapType)));
assert("reviewer output field gap matrix lists blocking severities", blockingSeverities.every((severity) => matrix.includes(severity)));
assert("reviewer output field gap matrix covers reviewer roles", reviewerRoles.every((role) => matrix.includes(role)));
assert("reviewer output field gap matrix covers all slots", requiredSlots.every((slot) => matrix.includes(slot)));
assert("reviewer output field gap matrix keeps reviewer fields external", requiredReviewerFields.every((field) => matrix.includes(field)));
assert("reviewer output field gap matrix requires followup fields", followupFields.every((field) => matrix.includes(field)));
assert("reviewer output field gap matrix includes command checks", commands.every((command) => matrix.includes(command)));
assert(
  "reviewer output field gap matrix protects live submission conversion",
  matrix.includes("data/phase30-human-evidence-submission.json") &&
    matrix.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output field gap matrix says it does not receive output",
  matrix.includes("字段缺口定位矩阵不接收 reviewer 输出") &&
    matrix.includes("不替代接收门禁") &&
    matrix.includes("不替代退回补交闭环")
);
assert(
  "reviewer output field gap matrix separates present and approval",
  matrix.includes("present 不表示 evidence accepted") &&
    matrix.includes("non-blocking-note") &&
    matrix.includes("不表示 release approval")
);
assert(
  "reviewer output field gap matrix routes blocking gaps",
  matrix.includes("block-receipt") &&
    matrix.includes("return-for-fix") &&
    matrix.includes("当前候选交付Reviewer输出退回与补交闭环记录.md")
);
assert(
  "reviewer output field gap matrix requires receipt retry through gate",
  matrix.includes("每次 receipt retry") &&
    matrix.includes("当前候选交付Reviewer输出接收门禁.md")
);
assert("reviewer output field gap matrix links receipt attempt log", matrix.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("reviewer output field gap matrix links field fix assignment", matrix.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("reviewer output field fix assignment links field gap matrix", assignment.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("reviewer output field gap matrix links field fix receipt retry readiness", matrix.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("reviewer output field fix receipt retry readiness links field gap matrix", receiptReadiness.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("receipt attempt log links field gap matrix", attempt.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("return resubmission closure record links field gap matrix", returnClosure.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("output receipt gate links field gap matrix", receiptGate.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("pre-review package links field gap matrix", preReview.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("review execution sequence links field gap matrix", sequence.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("review chain integrity index links field gap matrix", integrity.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("negative misuse check links field gap matrix", negative.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("final review package lock index links field gap matrix", finalLock.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert(
  "README links reviewer output field gap matrix",
  readme.includes("Current candidate reviewer output field gap matrix") &&
    readme.includes("项目文档/当前候选交付Reviewer输出字段缺口定位矩阵.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output field gap matrix checks passed.");
