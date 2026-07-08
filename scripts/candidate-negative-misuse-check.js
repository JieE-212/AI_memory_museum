const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const negativePath = path.join(docsDir, "当前候选交付负向用例防误用检查.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const sequencePath = path.join(docsDir, "当前候选交付人工审查执行顺序总表.md");
const integrityPath = path.join(docsDir, "当前候选交付人工审查链完整性索引.md");
const authorizationPath = path.join(docsDir, "当前候选交付维护者转换授权前置模板.md");
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
const negative = fs.readFileSync(negativePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const authorization = fs.readFileSync(authorizationPath, "utf8");

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

const falseSources = [
  "README.md",
  "当前候选交付审查前包索引.md",
  "当前候选交付人工审查执行顺序总表.md",
  "当前候选交付人工审查链完整性索引.md",
  "当前候选交付人工审查演练Dry-run记录模板.md",
  "阶段30人工审查会议包.md",
  "当前候选交付Reviewer输出接收门禁.md",
  "当前候选交付Reviewer输出离线汇总模板索引.md",
  "阶段30会后证据汇总包.md",
  "阶段30LiveSubmission转换预检包.md",
  "当前候选交付维护者转换授权前置模板.md",
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
  "阶段30发布决策准备信封.md",
  "阶段30发布审批决策包.md",
  "阶段29退出决策包.md",
  "阶段30入口决策包.md",
  "阶段30运行时GoNoGo决策包.md",
  "阶段30第三方执行审批边界.md",
  "npm.cmd run check",
  "candidate:*",
];

const invalidInterpretations = [
  "reviewer evidence",
  "receipt acceptance",
  "维护者授权",
  "live submission",
  "release approval",
  "Phase 29 exit",
  "Phase 30 entry",
  "runtime execution",
  "third-party execution",
  "human signoff",
];

const forbiddenMutations = [
  "data/phase30-human-evidence-submission.json",
  "releaseReady=true",
  "phase29ExitReady=true",
  "phase30EntryReady=true",
  "runtimeExecution",
  "thirdPartyExecution",
];

const commands = [
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:maintainer-conversion-authorization-check",
  "npm.cmd run candidate:review-dry-run-record-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run candidate:pre-review-package-check",
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
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
];

const placeholders = [
  "REPLACE_WITH_...",
  "YYYY-MM-DD",
  "pending",
  "missing",
  "unassigned",
];

assert("candidate negative misuse check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate negative misuse check command",
  packageJson.scripts["candidate:negative-misuse-check"] === "node scripts/candidate-negative-misuse-check.js"
);
assert(
  "check pipeline includes candidate negative misuse check",
  packageJson.scripts.check.includes("node scripts/candidate-negative-misuse-check.js")
);
assert("negative misuse check document exists", fs.existsSync(negativePath));
assert("negative misuse check is guard-only", negative.includes("negative-misuse-check-only"));
assert(
  "negative misuse check preserves candidate state",
  negative.includes("APP_VERSION=1.9.48") &&
    negative.includes("PHASE=29") &&
    negative.includes("rc-reviewable-but-not-releasable")
);
assert(
  "negative misuse check keeps gates blocked",
  negative.includes("releaseReady=false") &&
    negative.includes("phase29ExitReady=false") &&
    negative.includes("phase30EntryReady=false") &&
    negative.includes("runtimeExecution=false") &&
    negative.includes("thirdPartyExecution=false")
);
assert(
  "negative misuse check records missing evidence state",
  negative.includes("liveSubmissionExists=false") &&
    negative.includes("approvedSlots=0") &&
    negative.includes("missingSlots=10")
);
assert(
  "negative misuse check blocks maintainer conversion by default",
  negative.includes("maintainerConversionAuthorization=false") &&
    negative.includes("readyForLiveSubmissionCreation=false")
);
assert("negative misuse check lists false sources", falseSources.every((source) => negative.includes(source)));
assert("negative misuse check lists invalid interpretations", invalidInterpretations.every((item) => negative.includes(item)));
assert("negative misuse check covers required slots", requiredSlots.every((slot) => negative.includes(slot)));
assert("negative misuse check requires reviewer fields", requiredReviewerFields.every((field) => negative.includes(field)));
assert("negative misuse check requires followup fields", followupFields.every((field) => negative.includes(field)));
assert("negative misuse check rejects placeholders", placeholders.every((item) => negative.includes(item)));
assert("negative misuse check forbids risky mutations", forbiddenMutations.every((item) => negative.includes(item)));
assert("negative misuse check includes command checks", commands.every((command) => negative.includes(command)));
assert(
  "negative misuse check explicitly rejects common misuse claims",
  [
    "dry-run 通过，所以 reviewer evidence 已完成",
    "会议记录存在，所以 receipt acceptance 已完成",
    "npm.cmd run check",
    "conversion preflight 通过",
    "维护者转换授权前置模板存在，所以维护者已经授权",
    "最终锁定索引存在，所以 reviewer evidence 或 release approval 已完成",
    "Reviewer 已收到材料，所以 reviewer evidence 或 receipt acceptance 已完成",
    "材料签收回执存在，所以 Reviewer 输出接收门禁已经通过",
    "reviewer 已开始审查，所以 reviewer evidence 已产生",
    "澄清问题已解决，所以 reviewer evidence 已产生",
    "Reviewer 已补交，所以 Reviewer 输出接收门禁已经通过",
    "接收尝试记录存在，所以 Reviewer 输出接收门禁已经通过",
    "字段缺口定位矩阵里标为 present 或 non-blocking-note，所以 evidence acceptance 或 release approval 已完成",
    "字段修复责任分派单里标为 assigned 或 fix-submitted，所以字段已经修复或 Reviewer 输出接收门禁已经通过",
    "字段修复回执与重试准备记录里标为 received 或 ready-for-receipt-attempt，所以字段已经修复或 Reviewer 输出接收门禁已经通过",
    "重试批次登记表里标为 ready-for-receipt-attempt 或 queued-for-receipt-attempt，所以字段已经修复或 Reviewer 输出接收门禁已经通过",
    "发布决策准备信封存在，所以 release approval 已完成",
  ].every((claim) => negative.includes(claim))
);
assert("pre-review package links negative misuse check", preReview.includes("当前候选交付负向用例防误用检查.md"));
assert("review execution sequence links negative misuse check", sequence.includes("当前候选交付负向用例防误用检查.md"));
assert("review chain integrity index links negative misuse check", integrity.includes("当前候选交付负向用例防误用检查.md"));
assert("maintainer authorization template links negative misuse check", authorization.includes("当前候选交付负向用例防误用检查.md"));
assert("negative misuse check links final review package lock index", negative.includes("当前候选交付人工审查包最终锁定索引.md"));
assert("negative misuse check links reviewer handoff execution checklist", negative.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("negative misuse check links reviewer handoff receipt template", negative.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("negative misuse check links reviewer review start confirmation template", negative.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("negative misuse check links reviewer in-review blocker clarification ledger", negative.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("negative misuse check links reviewer output return resubmission closure record", negative.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("negative misuse check links reviewer output receipt attempt log", negative.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("negative misuse check links reviewer output field gap matrix", negative.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("negative misuse check links reviewer output field fix assignment", negative.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("negative misuse check links reviewer output field fix receipt retry readiness", negative.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("negative misuse check links reviewer output retry batch register", negative.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert(
  "README links negative misuse check",
  readme.includes("Current candidate negative misuse check") &&
    readme.includes("项目文档/当前候选交付负向用例防误用检查.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate negative misuse checks passed.");
