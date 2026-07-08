const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const receiptGatePath = path.join(docsDir, "当前候选交付Reviewer输出接收门禁.md");
const returnClosurePath = path.join(docsDir, "当前候选交付Reviewer输出退回与补交闭环记录.md");
const attemptPath = path.join(docsDir, "当前候选交付Reviewer输出接收尝试记录.md");
const fieldGapMatrixPath = path.join(docsDir, "当前候选交付Reviewer输出字段缺口定位矩阵.md");
const assignmentPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复责任分派单.md");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
const workbenchPath = path.join(docsDir, "当前候选交付Reviewer证据槽位工作台.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
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
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const attempt = fs.readFileSync(attemptPath, "utf8");
const fieldGapMatrix = fs.readFileSync(fieldGapMatrixPath, "utf8");
const assignment = fs.readFileSync(assignmentPath, "utf8");
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
const workbench = fs.readFileSync(workbenchPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");

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

const requiredFields = [
  "reviewer",
  "reviewedAt",
  "evidenceRef",
  "disposition",
  "decisionReason",
  "residualRisk",
];

const allowedDispositions = [
  "approved-with-evidence",
  "accepted-with-risk",
  "deferred-with-owner",
  "rejected",
  "blocked",
];

const followupFields = [
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const receiptFields = [
  "receiptAcceptedByMaintainer",
  "receivedAt",
  "receivedBy",
  "sourceBundleRef",
  "slotCount",
  "acceptedSlotCount",
  "rejectedSlotCount",
  "conflictCount",
  "riskFollowupCount",
  "readyForPostReviewSummary",
];

const forbiddenPlaceholders = [
  "REPLACE_WITH_...",
  "YYYY-MM-DD",
  "pending",
  "missing",
  "unassigned",
];

assert("candidate reviewer output receipt check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output receipt check command",
  packageJson.scripts["candidate:reviewer-output-receipt-check"] ===
    "node scripts/candidate-reviewer-output-receipt-check.js"
);
assert(
  "check pipeline includes candidate reviewer output receipt check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-receipt-check.js")
);

assert("reviewer output receipt gate document exists", fs.existsSync(receiptGatePath));
assert("reviewer output receipt gate is receipt-gate-only", receiptGate.includes("reviewer-output-receipt-gate-only"));
assert(
  "reviewer output receipt gate preserves candidate state",
  receiptGate.includes("rc-reviewable-but-not-releasable") &&
    receiptGate.includes("APP_VERSION=1.9.48") &&
    receiptGate.includes("PHASE=29")
);
assert(
  "reviewer output receipt gate keeps gates blocked",
  receiptGate.includes("releaseReady=false") &&
    receiptGate.includes("phase29ExitReady=false") &&
    receiptGate.includes("phase30EntryReady=false") &&
    receiptGate.includes("runtimeExecution=false") &&
    receiptGate.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output receipt gate records missing evidence state",
  receiptGate.includes("liveSubmissionExists=false") &&
    receiptGate.includes("approvedSlots=0") &&
    receiptGate.includes("missingSlots=10")
);
assert("reviewer output receipt gate lists all slots", requiredSlots.every((slot) => receiptGate.includes(slot)));
assert("reviewer output receipt gate lists required fields", requiredFields.every((field) => receiptGate.includes(field)));
assert(
  "reviewer output receipt gate lists allowed dispositions",
  allowedDispositions.every((value) => receiptGate.includes(value))
);
assert("reviewer output receipt gate lists followup fields", followupFields.every((field) => receiptGate.includes(field)));
assert("reviewer output receipt gate lists receipt fields", receiptFields.every((field) => receiptGate.includes(field)));
assert(
  "reviewer output receipt gate rejects placeholders",
  forbiddenPlaceholders.every((placeholder) => receiptGate.includes(placeholder))
);
assert(
  "reviewer output receipt gate protects live submission conversion",
  receiptGate.includes("data/phase30-human-evidence-submission.json") &&
    receiptGate.includes("维护者显式转换授权") &&
    receiptGate.includes("不得进入 live submission conversion preflight")
);
assert(
  "reviewer output receipt gate says it is not approval",
  receiptGate.includes("不是 release approval") &&
    receiptGate.includes("不证明任何 reviewer 输出已经被接收")
);
assert(
  "reviewer output receipt gate references downstream packages",
  [
    "当前候选交付人工审查执行顺序总表.md",
    "当前候选交付Reviewer输出退回与补交闭环记录.md",
    "当前候选交付Reviewer输出接收尝试记录.md",
    "当前候选交付Reviewer输出字段缺口定位矩阵.md",
    "当前候选交付Reviewer输出字段修复责任分派单.md",
    "当前候选交付Reviewer输出字段修复回执与重试准备记录.md",
    "当前候选交付Reviewer输出离线汇总模板索引.md",
    "当前候选交付Reviewer证据槽位工作台.md",
    "阶段30人工证据冲突审查包.md",
    "阶段30风险处置后续台账.md",
    "phase30:post-review-evidence-summary",
    "phase30:live-submission-conversion-preflight",
  ].every((item) => receiptGate.includes(item))
);
assert(
  "reviewer output receipt gate includes command checks",
  [
    "npm.cmd run candidate:reviewer-output-receipt-check",
    "npm.cmd run candidate:reviewer-output-field-gap-matrix-check",
    "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
    "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
    "npm.cmd run candidate:reviewer-output-return-resubmission-closure-check",
    "npm.cmd run candidate:reviewer-output-receipt-attempt-log-check",
    "npm.cmd run candidate:reviewer-output-summary-template-check",
    "npm.cmd run candidate:review-execution-sequence-check",
    "npm.cmd run candidate:reviewer-workbench-check",
    "npm.cmd run candidate:pre-review-package-check",
    "npm.cmd run phase30:evidence-closure-status",
    "npm.cmd run check",
  ].every((command) => receiptGate.includes(command))
);
assert("reviewer workbench links output receipt gate", workbench.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("reviewer output receipt gate links return resubmission closure record", receiptGate.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("reviewer output return resubmission closure record links output receipt gate", returnClosure.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("reviewer output receipt gate links receipt attempt log", receiptGate.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("reviewer output receipt attempt log links output receipt gate", attempt.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("reviewer output receipt gate links field gap matrix", receiptGate.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("reviewer output field gap matrix links output receipt gate", fieldGapMatrix.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("reviewer output receipt gate links field fix assignment", receiptGate.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("reviewer output field fix assignment links output receipt gate", assignment.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("reviewer output receipt gate links field fix receipt retry readiness", receiptGate.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("reviewer output field fix receipt retry readiness links output receipt gate", receiptReadiness.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("pre-review package links output receipt gate", preReview.includes("当前候选交付Reviewer输出接收门禁.md"));
assert(
  "README links output receipt gate",
  readme.includes("Current candidate reviewer output receipt gate") &&
    readme.includes("项目文档/当前候选交付Reviewer输出接收门禁.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output receipt gate checks passed.");
