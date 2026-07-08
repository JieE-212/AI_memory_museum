const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const finalLockPath = path.join(docsDir, "当前候选交付人工审查包最终锁定索引.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const sequencePath = path.join(docsDir, "当前候选交付人工审查执行顺序总表.md");
const integrityPath = path.join(docsDir, "当前候选交付人工审查链完整性索引.md");
const negativePath = path.join(docsDir, "当前候选交付负向用例防误用检查.md");
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
const finalLock = fs.readFileSync(finalLockPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");

const lockedMaterials = [
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
  "阶段30会后证据汇总包.md",
  "阶段30人工证据冲突审查包.md",
  "阶段30风险处置后续台账.md",
  "阶段30LiveSubmission转换预检包.md",
  "当前候选交付维护者转换授权前置模板.md",
  "当前候选交付负向用例防误用检查.md",
  "当前候选交付人工审查包最终锁定索引.md",
  "当前候选交付Reviewer实际交付执行清单.md",
  "当前候选交付Reviewer交付签收与退回回执模板.md",
  "当前候选交付Reviewer审查启动确认模板.md",
  "当前候选交付Reviewer审查中阻塞与澄清问题台账.md",
  "当前候选交付Reviewer输出退回与补交闭环记录.md",
  "当前候选交付Reviewer输出接收尝试记录.md",
  "当前候选交付Reviewer输出字段缺口定位矩阵.md",
  "当前候选交付Reviewer输出字段修复责任分派单.md",
  "当前候选交付Reviewer输出字段修复回执与重试准备记录.md",
  "当前候选交付Reviewer输出重试批次登记表.md",
];

const requiredCommands = [
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run candidate:delivery-ui-check",
  "npm.cmd run candidate:user-path-check",
  "npm.cmd run candidate:import-path-check",
  "npm.cmd run candidate:handoff-index-check",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run candidate:reviewer-workbench-check",
  "npm.cmd run candidate:reviewer-output-receipt-check",
  "npm.cmd run candidate:reviewer-output-summary-template-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-dry-run-record-check",
  "npm.cmd run candidate:maintainer-conversion-authorization-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:final-review-package-lock-check",
  "npm.cmd run candidate:reviewer-handoff-execution-check",
  "npm.cmd run candidate:reviewer-handoff-receipt-check",
  "npm.cmd run candidate:reviewer-review-start-confirmation-check",
  "npm.cmd run candidate:reviewer-in-review-blocker-clarification-check",
  "npm.cmd run candidate:reviewer-output-return-resubmission-closure-check",
  "npm.cmd run candidate:reviewer-output-receipt-attempt-log-check",
  "npm.cmd run candidate:reviewer-output-field-gap-matrix-check",
  "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
  "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
  "npm.cmd run candidate:reviewer-output-retry-batch-register-check",
  "npm.cmd run phase30:live-submission-conversion-preflight",
  "npm.cmd run check",
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

const lockFlags = [
  "finalReviewPackageLocked=true",
  "lockedForReviewerHandoff=true",
  "lockedForReleaseApproval=false",
  "lockedForLiveSubmission=false",
  "lockedForRuntimeExecution=false",
  "lockedForThirdPartyExecution=false",
];

const forbiddenInterpretations = [
  "reviewer evidence",
  "receipt acceptance",
  "维护者授权",
  "live submission",
  "release approval",
  "runtimeExecution",
  "thirdPartyExecution",
];

assert("candidate final review package lock check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate final review package lock check command",
  packageJson.scripts["candidate:final-review-package-lock-check"] ===
    "node scripts/candidate-final-review-package-lock-check.js"
);
assert(
  "check pipeline includes candidate final review package lock check",
  packageJson.scripts.check.includes("node scripts/candidate-final-review-package-lock-check.js")
);
assert("final review package lock index exists", fs.existsSync(finalLockPath));
assert("final review package lock index is lock-only", finalLock.includes("final-review-package-lock-index-only"));
assert(
  "final review package lock index preserves candidate state",
  finalLock.includes("APP_VERSION=1.9.48") &&
    finalLock.includes("PHASE=29") &&
    finalLock.includes("rc-reviewable-but-not-releasable")
);
assert(
  "final review package lock index keeps gates blocked",
  finalLock.includes("releaseReady=false") &&
    finalLock.includes("phase29ExitReady=false") &&
    finalLock.includes("phase30EntryReady=false") &&
    finalLock.includes("runtimeExecution=false") &&
    finalLock.includes("thirdPartyExecution=false")
);
assert(
  "final review package lock index records missing evidence state",
  finalLock.includes("liveSubmissionExists=false") &&
    finalLock.includes("approvedSlots=0") &&
    finalLock.includes("missingSlots=10")
);
assert(
  "final review package lock index blocks conversion by default",
  finalLock.includes("maintainerConversionAuthorization=false") &&
    finalLock.includes("readyForLiveSubmissionCreation=false")
);
assert("final review package lock index lists locked materials", lockedMaterials.every((item) => finalLock.includes(item)));
assert("final review package lock index lists required commands", requiredCommands.every((command) => finalLock.includes(command)));
assert("final review package lock index covers all slots", requiredSlots.every((slot) => finalLock.includes(slot)));
assert("final review package lock index requires reviewer fields", requiredReviewerFields.every((field) => finalLock.includes(field)));
assert("final review package lock index requires followup fields", followupFields.every((field) => finalLock.includes(field)));
assert("final review package lock index records lock flags", lockFlags.every((flag) => finalLock.includes(flag)));
assert("final review package lock index rejects false interpretations", forbiddenInterpretations.every((item) => finalLock.includes(item)));
assert(
  "final review package lock index protects live submission conversion",
  finalLock.includes("data/phase30-human-evidence-submission.json") &&
    finalLock.includes("不得在仓库保存真实 reviewer 输出")
);
assert("pre-review package links final review package lock index", preReview.includes("当前候选交付人工审查包最终锁定索引.md"));
assert("review execution sequence links final review package lock index", sequence.includes("当前候选交付人工审查包最终锁定索引.md"));
assert("review chain integrity index links final review package lock index", integrity.includes("当前候选交付人工审查包最终锁定索引.md"));
assert("negative misuse check links final review package lock index", negative.includes("当前候选交付人工审查包最终锁定索引.md"));
assert("final review package lock index links reviewer handoff execution checklist", finalLock.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("final review package lock index links reviewer handoff receipt template", finalLock.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("final review package lock index links reviewer review start confirmation template", finalLock.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("final review package lock index links reviewer in-review blocker clarification ledger", finalLock.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("final review package lock index links reviewer output return resubmission closure record", finalLock.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("final review package lock index links reviewer output receipt attempt log", finalLock.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("final review package lock index links reviewer output field gap matrix", finalLock.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("final review package lock index links reviewer output field fix assignment", finalLock.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("final review package lock index links reviewer output field fix receipt retry readiness", finalLock.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("final review package lock index links reviewer output retry batch register", finalLock.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert(
  "README links final review package lock index",
  readme.includes("Current candidate final review package lock index") &&
    readme.includes("项目文档/当前候选交付人工审查包最终锁定索引.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate final review package lock checks passed.");
