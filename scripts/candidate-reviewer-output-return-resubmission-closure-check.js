const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const returnClosurePath = path.join(docsDir, "当前候选交付Reviewer输出退回与补交闭环记录.md");
const attemptPath = path.join(docsDir, "当前候选交付Reviewer输出接收尝试记录.md");
const fieldGapMatrixPath = path.join(docsDir, "当前候选交付Reviewer输出字段缺口定位矩阵.md");
const assignmentPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复责任分派单.md");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
const blockerPath = path.join(docsDir, "当前候选交付Reviewer审查中阻塞与澄清问题台账.md");
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
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const attempt = fs.readFileSync(attemptPath, "utf8");
const fieldGapMatrix = fs.readFileSync(fieldGapMatrixPath, "utf8");
const assignment = fs.readFileSync(assignmentPath, "utf8");
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
const blocker = fs.readFileSync(blockerPath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const closureFields = [
  "returnClosureId",
  "sourceClarificationId",
  "sourceReceiptAttemptId",
  "reviewerName",
  "reviewerRole",
  "affectedEvidenceSlots",
  "returnReasonType",
  "returnReasonSummary",
  "returnedBy",
  "returnedAt",
  "requestedFix",
  "resubmissionOwner",
  "resubmissionDueAt",
  "resubmissionPackageRef",
  "resubmittedAt",
  "receiptRetryRequired",
  "receiptRetryCommand",
  "closureStatus",
  "closureSummary",
  "closedAt",
  "nextAction",
];

const returnReasonTypes = [
  "missing-required-field",
  "placeholder-detected",
  "missing-evidence-slot",
  "unclear-evidence-ref",
  "conflicting-disposition",
  "missing-risk-followup",
  "out-of-scope-output",
  "wrong-reviewer-role",
  "material-fix-required",
];

const closureStatuses = [
  "returned",
  "fix-requested",
  "resubmitted",
  "ready-for-receipt-retry",
  "closed",
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
  "npm.cmd run candidate:reviewer-output-return-resubmission-closure-check",
  "npm.cmd run candidate:reviewer-output-field-gap-matrix-check",
  "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
  "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
  "npm.cmd run candidate:reviewer-output-receipt-attempt-log-check",
  "npm.cmd run candidate:reviewer-in-review-blocker-clarification-check",
  "npm.cmd run candidate:reviewer-review-start-confirmation-check",
  "npm.cmd run candidate:reviewer-output-receipt-check",
  "npm.cmd run candidate:reviewer-handoff-receipt-check",
  "npm.cmd run candidate:reviewer-handoff-execution-check",
  "npm.cmd run candidate:final-review-package-lock-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
];

assert("candidate reviewer output return resubmission closure check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output return resubmission closure check command",
  packageJson.scripts["candidate:reviewer-output-return-resubmission-closure-check"] ===
    "node scripts/candidate-reviewer-output-return-resubmission-closure-check.js"
);
assert(
  "check pipeline includes candidate reviewer output return resubmission closure check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-return-resubmission-closure-check.js")
);
assert("reviewer output return resubmission closure record exists", fs.existsSync(returnClosurePath));
assert("reviewer output return resubmission closure record is record-only", returnClosure.includes("reviewer-output-return-resubmission-closure-record-only"));
assert(
  "reviewer output return resubmission closure record preserves candidate state",
  returnClosure.includes("APP_VERSION=1.9.48") &&
    returnClosure.includes("PHASE=29") &&
    returnClosure.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output return resubmission closure record keeps gates blocked",
  returnClosure.includes("releaseReady=false") &&
    returnClosure.includes("phase29ExitReady=false") &&
    returnClosure.includes("phase30EntryReady=false") &&
    returnClosure.includes("runtimeExecution=false") &&
    returnClosure.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output return resubmission closure record records missing evidence state",
  returnClosure.includes("liveSubmissionExists=false") &&
    returnClosure.includes("approvedSlots=0") &&
    returnClosure.includes("missingSlots=10")
);
assert(
  "reviewer output return resubmission closure record blocks conversion by default",
  returnClosure.includes("maintainerConversionAuthorization=false") &&
    returnClosure.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output return resubmission closure record lists fields", closureFields.every((field) => returnClosure.includes(field)));
assert("reviewer output return resubmission closure record lists reason types", returnReasonTypes.every((reasonType) => returnClosure.includes(reasonType)));
assert("reviewer output return resubmission closure record lists statuses", closureStatuses.every((status) => returnClosure.includes(status)));
assert("reviewer output return resubmission closure record covers reviewer roles", reviewerRoles.every((role) => returnClosure.includes(role)));
assert("reviewer output return resubmission closure record covers all slots", requiredSlots.every((slot) => returnClosure.includes(slot)));
assert("reviewer output return resubmission closure record keeps reviewer fields external", requiredReviewerFields.every((field) => returnClosure.includes(field)));
assert("reviewer output return resubmission closure record requires followup fields", followupFields.every((field) => returnClosure.includes(field)));
assert("reviewer output return resubmission closure record includes command checks", commands.every((command) => returnClosure.includes(command)));
assert(
  "reviewer output return resubmission closure record protects live submission conversion",
  returnClosure.includes("data/phase30-human-evidence-submission.json") &&
    returnClosure.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output return resubmission closure record says resubmission is not evidence",
  returnClosure.includes("resubmitted") &&
    returnClosure.includes("ready-for-receipt-retry") &&
    returnClosure.includes("不是 reviewer 输出") &&
    returnClosure.includes("不是 Reviewer 输出接收门禁通过")
);
assert("reviewer output return resubmission closure record links blocker clarification ledger", returnClosure.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("reviewer output return resubmission closure record links receipt attempt log", returnClosure.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("reviewer output receipt attempt log links return resubmission closure record", attempt.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("reviewer output return resubmission closure record links field gap matrix", returnClosure.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("reviewer output field gap matrix links return resubmission closure record", fieldGapMatrix.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("reviewer output return resubmission closure record links field fix assignment", returnClosure.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("reviewer output field fix assignment links return resubmission closure record", assignment.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("reviewer output return resubmission closure record links field fix receipt retry readiness", returnClosure.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("reviewer output field fix receipt retry readiness links return resubmission closure record", receiptReadiness.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("reviewer output return resubmission closure record links output receipt gate", returnClosure.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("blocker clarification ledger links return resubmission closure record", blocker.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("output receipt gate links return resubmission closure record", receiptGate.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("pre-review package links return resubmission closure record", preReview.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("review execution sequence links return resubmission closure record", sequence.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("review chain integrity index links return resubmission closure record", integrity.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("negative misuse check links return resubmission closure record", negative.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("final review package lock index links return resubmission closure record", finalLock.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert(
  "README links reviewer output return resubmission closure record",
  readme.includes("Current candidate reviewer output return resubmission closure record") &&
    readme.includes("项目文档/当前候选交付Reviewer输出退回与补交闭环记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output return resubmission closure checks passed.");
