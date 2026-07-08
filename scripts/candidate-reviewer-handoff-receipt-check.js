const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const handoffReceiptPath = path.join(docsDir, "当前候选交付Reviewer交付签收与退回回执模板.md");
const reviewStartPath = path.join(docsDir, "当前候选交付Reviewer审查启动确认模板.md");
const handoffExecutionPath = path.join(docsDir, "当前候选交付Reviewer实际交付执行清单.md");
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
const handoffReceipt = fs.readFileSync(handoffReceiptPath, "utf8");
const reviewStart = fs.readFileSync(reviewStartPath, "utf8");
const handoffExecution = fs.readFileSync(handoffExecutionPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const receiptFields = [
  "handoffReceiptId",
  "sourceHandoffExecutionId",
  "handoffPackageRef",
  "reviewerName",
  "reviewerRole",
  "reviewerContact",
  "receivedAt",
  "receiptStatus",
  "materialsReceived",
  "missingMaterials",
  "unclearScopeItems",
  "returnedAt",
  "returnReason",
  "requestedFix",
  "resubmissionOwner",
  "resubmissionDueAt",
  "redlinesAcknowledged",
  "misuseGuardAcknowledged",
  "nextAction",
];

const receiptStatuses = [
  "package-received",
  "returned-for-missing-material",
  "returned-for-unclear-scope",
  "returned-for-wrong-reviewer",
  "blocked-by-reviewer-unavailability",
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

const commands = [
  "npm.cmd run candidate:reviewer-handoff-receipt-check",
  "npm.cmd run candidate:reviewer-review-start-confirmation-check",
  "npm.cmd run candidate:reviewer-in-review-blocker-clarification-check",
  "npm.cmd run candidate:reviewer-handoff-execution-check",
  "npm.cmd run candidate:final-review-package-lock-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
];

assert("candidate reviewer handoff receipt check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer handoff receipt check command",
  packageJson.scripts["candidate:reviewer-handoff-receipt-check"] ===
    "node scripts/candidate-reviewer-handoff-receipt-check.js"
);
assert(
  "check pipeline includes candidate reviewer handoff receipt check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-handoff-receipt-check.js")
);
assert("reviewer handoff receipt template exists", fs.existsSync(handoffReceiptPath));
assert("reviewer handoff receipt template is template-only", handoffReceipt.includes("reviewer-handoff-receipt-template-only"));
assert(
  "reviewer handoff receipt template preserves candidate state",
  handoffReceipt.includes("APP_VERSION=1.9.48") &&
    handoffReceipt.includes("PHASE=29") &&
    handoffReceipt.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer handoff receipt template keeps gates blocked",
  handoffReceipt.includes("releaseReady=false") &&
    handoffReceipt.includes("phase29ExitReady=false") &&
    handoffReceipt.includes("phase30EntryReady=false") &&
    handoffReceipt.includes("runtimeExecution=false") &&
    handoffReceipt.includes("thirdPartyExecution=false")
);
assert(
  "reviewer handoff receipt template records missing evidence state",
  handoffReceipt.includes("liveSubmissionExists=false") &&
    handoffReceipt.includes("approvedSlots=0") &&
    handoffReceipt.includes("missingSlots=10")
);
assert(
  "reviewer handoff receipt template blocks conversion by default",
  handoffReceipt.includes("maintainerConversionAuthorization=false") &&
    handoffReceipt.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer handoff receipt template lists fields", receiptFields.every((field) => handoffReceipt.includes(field)));
assert("reviewer handoff receipt template lists statuses", receiptStatuses.every((status) => handoffReceipt.includes(status)));
assert("reviewer handoff receipt template covers reviewer roles", reviewerRoles.every((role) => handoffReceipt.includes(role)));
assert("reviewer handoff receipt template covers all slots", requiredSlots.every((slot) => handoffReceipt.includes(slot)));
assert("reviewer handoff receipt template requires reviewer fields remain external", requiredReviewerFields.every((field) => handoffReceipt.includes(field)));
assert("reviewer handoff receipt template includes command checks", commands.every((command) => handoffReceipt.includes(command)));
assert(
  "reviewer handoff receipt template protects live submission conversion",
  handoffReceipt.includes("data/phase30-human-evidence-submission.json") &&
    handoffReceipt.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer handoff receipt template says receipt is not evidence",
  handoffReceipt.includes("package-received") &&
    handoffReceipt.includes("不是 reviewer 输出") &&
    handoffReceipt.includes("不是 Reviewer 输出接收门禁通过")
);
assert("reviewer handoff receipt template links reviewer review start confirmation template", handoffReceipt.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("reviewer handoff receipt template links reviewer in-review blocker clarification ledger", handoffReceipt.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("reviewer review start confirmation template links reviewer handoff receipt template", reviewStart.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("reviewer handoff execution checklist links reviewer handoff receipt template", handoffExecution.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("pre-review package links reviewer handoff receipt template", preReview.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("review execution sequence links reviewer handoff receipt template", sequence.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("review chain integrity index links reviewer handoff receipt template", integrity.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("negative misuse check links reviewer handoff receipt template", negative.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("final review package lock index links reviewer handoff receipt template", finalLock.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert(
  "README links reviewer handoff receipt template",
  readme.includes("Current candidate reviewer handoff receipt template") &&
    readme.includes("项目文档/当前候选交付Reviewer交付签收与退回回执模板.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer handoff receipt checks passed.");
