const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
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
const handoffExecution = fs.readFileSync(handoffExecutionPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

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

const reviewerRoles = [
  "release owner",
  "runtime owner",
  "security reviewer",
  "data steward",
  "audit reviewer",
];

const handoffFields = [
  "handoffExecutionId",
  "handoffPreparedAt",
  "handoffPreparedBy",
  "handoffPackageRef",
  "reviewerName",
  "reviewerRole",
  "reviewerContact",
  "assignedEvidenceSlots",
  "materialsDelivered",
  "commandsDelivered",
  "redlinesAcknowledged",
  "misuseGuardAcknowledged",
  "returnChannel",
  "dueAt",
  "handoffStatus",
  "returnReason",
  "nextAction",
];

const handoffStatuses = [
  "ready-to-send",
  "sent-to-reviewer",
  "received-by-reviewer",
  "returned-for-missing-material",
  "returned-for-unclear-scope",
  "blocked-by-reviewer-unavailability",
  "cancelled",
];

const requiredMaterials = [
  "README.md",
  "当前候选交付变更索引.md",
  "当前候选交付验收说明.md",
  "阶段30人工证据闭环状态审计.md",
  "当前候选交付审查前包索引.md",
  "当前候选交付人工审查执行顺序总表.md",
  "当前候选交付人工审查链完整性索引.md",
  "当前候选交付人工审查演练Dry-run记录模板.md",
  "阶段30人工Reviewer交接包.md",
  "当前候选交付Reviewer证据槽位工作台.md",
  "阶段30人工审查会议包.md",
  "当前候选交付Reviewer输出接收门禁.md",
  "当前候选交付Reviewer输出离线汇总模板索引.md",
  "当前候选交付负向用例防误用检查.md",
  "当前候选交付人工审查包最终锁定索引.md",
  "当前候选交付Reviewer交付签收与退回回执模板.md",
  "当前候选交付Reviewer审查启动确认模板.md",
  "当前候选交付Reviewer审查中阻塞与澄清问题台账.md",
];

const commands = [
  "npm.cmd run candidate:reviewer-handoff-execution-check",
  "npm.cmd run candidate:reviewer-handoff-receipt-check",
  "npm.cmd run candidate:reviewer-review-start-confirmation-check",
  "npm.cmd run candidate:reviewer-in-review-blocker-clarification-check",
  "npm.cmd run candidate:final-review-package-lock-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
];

const requiredReviewerFields = [
  "reviewer",
  "reviewedAt",
  "evidenceRef",
  "disposition",
  "decisionReason",
  "residualRisk",
];

assert("candidate reviewer handoff execution check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer handoff execution check command",
  packageJson.scripts["candidate:reviewer-handoff-execution-check"] ===
    "node scripts/candidate-reviewer-handoff-execution-check.js"
);
assert(
  "check pipeline includes candidate reviewer handoff execution check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-handoff-execution-check.js")
);
assert("reviewer handoff execution checklist exists", fs.existsSync(handoffExecutionPath));
assert("reviewer handoff execution checklist is checklist-only", handoffExecution.includes("reviewer-handoff-execution-checklist-only"));
assert(
  "reviewer handoff execution checklist preserves candidate state",
  handoffExecution.includes("APP_VERSION=1.9.48") &&
    handoffExecution.includes("PHASE=29") &&
    handoffExecution.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer handoff execution checklist keeps gates blocked",
  handoffExecution.includes("releaseReady=false") &&
    handoffExecution.includes("phase29ExitReady=false") &&
    handoffExecution.includes("phase30EntryReady=false") &&
    handoffExecution.includes("runtimeExecution=false") &&
    handoffExecution.includes("thirdPartyExecution=false")
);
assert(
  "reviewer handoff execution checklist records missing evidence state",
  handoffExecution.includes("liveSubmissionExists=false") &&
    handoffExecution.includes("approvedSlots=0") &&
    handoffExecution.includes("missingSlots=10")
);
assert(
  "reviewer handoff execution checklist blocks conversion by default",
  handoffExecution.includes("maintainerConversionAuthorization=false") &&
    handoffExecution.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer handoff execution checklist lists prerequisite docs", requiredMaterials.slice(4, 15).every((item) => handoffExecution.includes(item)));
assert("reviewer handoff execution checklist lists handoff fields", handoffFields.every((field) => handoffExecution.includes(field)));
assert("reviewer handoff execution checklist lists handoff statuses", handoffStatuses.every((status) => handoffExecution.includes(status)));
assert("reviewer handoff execution checklist covers reviewer roles", reviewerRoles.every((role) => handoffExecution.includes(role)));
assert("reviewer handoff execution checklist covers all slots", requiredSlots.every((slot) => handoffExecution.includes(slot)));
assert("reviewer handoff execution checklist lists delivery materials", requiredMaterials.every((item) => handoffExecution.includes(item)));
assert("reviewer handoff execution checklist includes command checks", commands.every((command) => handoffExecution.includes(command)));
assert("reviewer handoff execution checklist forbids filling reviewer fields", requiredReviewerFields.every((field) => handoffExecution.includes(field)));
assert(
  "reviewer handoff execution checklist protects live submission conversion",
  handoffExecution.includes("data/phase30-human-evidence-submission.json") &&
    handoffExecution.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer handoff execution checklist says delivery is not evidence",
  handoffExecution.includes("sent-to-reviewer") &&
    handoffExecution.includes("received-by-reviewer") &&
    handoffExecution.includes("不是 reviewer 输出") &&
    handoffExecution.includes("不证明 reviewer 已经完成审查")
);
assert("pre-review package links reviewer handoff execution checklist", preReview.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("review execution sequence links reviewer handoff execution checklist", sequence.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("review chain integrity index links reviewer handoff execution checklist", integrity.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("negative misuse check links reviewer handoff execution checklist", negative.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("final review package lock index links reviewer handoff execution checklist", finalLock.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("reviewer handoff execution checklist links reviewer handoff receipt template", handoffExecution.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("reviewer handoff execution checklist links reviewer review start confirmation template", handoffExecution.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("reviewer handoff execution checklist links reviewer in-review blocker clarification ledger", handoffExecution.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert(
  "README links reviewer handoff execution checklist",
  readme.includes("Current candidate reviewer handoff execution checklist") &&
    readme.includes("项目文档/当前候选交付Reviewer实际交付执行清单.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer handoff execution checks passed.");
