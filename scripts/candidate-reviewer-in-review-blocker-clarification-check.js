const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const blockerPath = path.join(docsDir, "当前候选交付Reviewer审查中阻塞与澄清问题台账.md");
const returnClosurePath = path.join(docsDir, "当前候选交付Reviewer输出退回与补交闭环记录.md");
const reviewStartPath = path.join(docsDir, "当前候选交付Reviewer审查启动确认模板.md");
const receiptGatePath = path.join(docsDir, "当前候选交付Reviewer输出接收门禁.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const sequencePath = path.join(docsDir, "当前候选交付人工审查执行顺序总表.md");
const integrityPath = path.join(docsDir, "当前候选交付人工审查链完整性索引.md");
const negativePath = path.join(docsDir, "当前候选交付负向用例防误用检查.md");
const finalLockPath = path.join(docsDir, "当前候选交付人工审查包最终锁定索引.md");
const handoffReceiptPath = path.join(docsDir, "当前候选交付Reviewer交付签收与退回回执模板.md");
const handoffExecutionPath = path.join(docsDir, "当前候选交付Reviewer实际交付执行清单.md");
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
const blocker = fs.readFileSync(blockerPath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const reviewStart = fs.readFileSync(reviewStartPath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");
const handoffReceipt = fs.readFileSync(handoffReceiptPath, "utf8");
const handoffExecution = fs.readFileSync(handoffExecutionPath, "utf8");

const ledgerFields = [
  "clarificationId",
  "sourceReviewStartConfirmationId",
  "reviewerName",
  "reviewerRole",
  "affectedEvidenceSlots",
  "issueType",
  "issueSummary",
  "question",
  "requestedFrom",
  "owner",
  "openedAt",
  "targetResponseAt",
  "status",
  "resolutionSummary",
  "resolvedAt",
  "nextAction",
];

const issueTypes = [
  "missing-material",
  "unclear-scope",
  "conflicting-instruction",
  "missing-context",
  "role-mismatch",
  "blocked-by-policy",
  "needs-maintainer-clarification",
];

const statuses = [
  "open",
  "answered",
  "returned-for-material-fix",
  "blocked",
  "resolved",
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
  "npm.cmd run candidate:reviewer-in-review-blocker-clarification-check",
  "npm.cmd run candidate:reviewer-output-return-resubmission-closure-check",
  "npm.cmd run candidate:reviewer-review-start-confirmation-check",
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

assert("candidate reviewer in-review blocker clarification check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer in-review blocker clarification check command",
  packageJson.scripts["candidate:reviewer-in-review-blocker-clarification-check"] ===
    "node scripts/candidate-reviewer-in-review-blocker-clarification-check.js"
);
assert(
  "check pipeline includes candidate reviewer in-review blocker clarification check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-in-review-blocker-clarification-check.js")
);
assert("reviewer in-review blocker clarification ledger exists", fs.existsSync(blockerPath));
assert("reviewer in-review blocker clarification ledger is ledger-only", blocker.includes("reviewer-in-review-blocker-clarification-ledger-only"));
assert(
  "reviewer in-review blocker clarification ledger preserves candidate state",
  blocker.includes("APP_VERSION=1.9.48") &&
    blocker.includes("PHASE=29") &&
    blocker.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer in-review blocker clarification ledger keeps gates blocked",
  blocker.includes("releaseReady=false") &&
    blocker.includes("phase29ExitReady=false") &&
    blocker.includes("phase30EntryReady=false") &&
    blocker.includes("runtimeExecution=false") &&
    blocker.includes("thirdPartyExecution=false")
);
assert(
  "reviewer in-review blocker clarification ledger records missing evidence state",
  blocker.includes("liveSubmissionExists=false") &&
    blocker.includes("approvedSlots=0") &&
    blocker.includes("missingSlots=10")
);
assert(
  "reviewer in-review blocker clarification ledger blocks conversion by default",
  blocker.includes("maintainerConversionAuthorization=false") &&
    blocker.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer in-review blocker clarification ledger lists fields", ledgerFields.every((field) => blocker.includes(field)));
assert("reviewer in-review blocker clarification ledger lists issue types", issueTypes.every((issueType) => blocker.includes(issueType)));
assert("reviewer in-review blocker clarification ledger lists statuses", statuses.every((status) => blocker.includes(status)));
assert("reviewer in-review blocker clarification ledger covers reviewer roles", reviewerRoles.every((role) => blocker.includes(role)));
assert("reviewer in-review blocker clarification ledger covers all slots", requiredSlots.every((slot) => blocker.includes(slot)));
assert("reviewer in-review blocker clarification ledger keeps reviewer output fields external", requiredReviewerFields.every((field) => blocker.includes(field)));
assert("reviewer in-review blocker clarification ledger requires followup fields", followupFields.every((field) => blocker.includes(field)));
assert("reviewer in-review blocker clarification ledger includes command checks", commands.every((command) => blocker.includes(command)));
assert(
  "reviewer in-review blocker clarification ledger protects live submission conversion",
  blocker.includes("data/phase30-human-evidence-submission.json") &&
    blocker.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer in-review blocker clarification ledger says clarification is not evidence",
  blocker.includes("answered") &&
    blocker.includes("resolved") &&
    blocker.includes("不是 reviewer 输出") &&
    blocker.includes("不是 Reviewer 输出接收门禁通过")
);
assert("reviewer in-review blocker clarification ledger links review start confirmation", blocker.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("reviewer in-review blocker clarification ledger links return resubmission closure record", blocker.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("reviewer output return resubmission closure record links blocker clarification ledger", returnClosure.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("reviewer in-review blocker clarification ledger links output receipt gate", blocker.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("review start confirmation links in-review blocker clarification ledger", reviewStart.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("output receipt gate links in-review blocker clarification ledger", receiptGate.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("handoff receipt links in-review blocker clarification ledger", handoffReceipt.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("handoff execution links in-review blocker clarification ledger", handoffExecution.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("pre-review package links in-review blocker clarification ledger", preReview.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("review execution sequence links in-review blocker clarification ledger", sequence.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("review chain integrity index links in-review blocker clarification ledger", integrity.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("negative misuse check links in-review blocker clarification ledger", negative.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("final review package lock index links in-review blocker clarification ledger", finalLock.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert(
  "README links reviewer in-review blocker clarification ledger",
  readme.includes("Current candidate reviewer in-review blocker clarification ledger") &&
    readme.includes("项目文档/当前候选交付Reviewer审查中阻塞与澄清问题台账.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer in-review blocker clarification checks passed.");
