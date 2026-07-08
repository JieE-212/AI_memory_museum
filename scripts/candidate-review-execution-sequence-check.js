const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const sequencePath = path.join(docsDir, "当前候选交付人工审查执行顺序总表.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const receiptGatePath = path.join(docsDir, "当前候选交付Reviewer输出接收门禁.md");
const blockerLedgerPath = path.join(docsDir, "当前候选交付Reviewer审查中阻塞与澄清问题台账.md");
const returnClosurePath = path.join(docsDir, "当前候选交付Reviewer输出退回与补交闭环记录.md");
const receiptAttemptPath = path.join(docsDir, "当前候选交付Reviewer输出接收尝试记录.md");
const fieldGapMatrixPath = path.join(docsDir, "当前候选交付Reviewer输出字段缺口定位矩阵.md");
const assignmentPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复责任分派单.md");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
const retryBatchPath = path.join(docsDir, "当前候选交付Reviewer输出重试批次登记表.md");
const summaryTemplatePath = path.join(docsDir, "当前候选交付Reviewer输出离线汇总模板索引.md");
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
const sequence = fs.readFileSync(sequencePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const blockerLedger = fs.readFileSync(blockerLedgerPath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const receiptAttempt = fs.readFileSync(receiptAttemptPath, "utf8");
const fieldGapMatrix = fs.readFileSync(fieldGapMatrixPath, "utf8");
const assignment = fs.readFileSync(assignmentPath, "utf8");
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
const retryBatch = fs.readFileSync(retryBatchPath, "utf8");
const summaryTemplate = fs.readFileSync(summaryTemplatePath, "utf8");

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

const followupFields = [
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const orderedMaterials = [
  "阶段30人工证据闭环状态审计.md",
  "当前候选交付审查前包索引.md",
  "当前候选交付人工审查链完整性索引.md",
  "当前候选交付人工审查演练Dry-run记录模板.md",
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
  "当前候选交付变更索引.md",
  "当前候选交付验收说明.md",
  "阶段30人工Reviewer交接包.md",
  "当前候选交付Reviewer证据槽位工作台.md",
  "阶段30人工审查会议包.md",
  "当前候选交付Reviewer输出接收门禁.md",
  "当前候选交付Reviewer输出离线汇总模板索引.md",
  "阶段30会后证据汇总包.md",
  "阶段30人工证据冲突审查包.md",
  "阶段30风险处置后续台账.md",
  "阶段30LiveSubmission转换预检包.md",
  "阶段30发布决策准备信封.md",
  "阶段30发布审批决策包.md",
  "阶段29退出决策包.md",
  "阶段30入口决策包.md",
  "阶段30运行时GoNoGo决策包.md",
  "阶段30第三方执行审批边界.md",
  "阶段30人工证据提交门禁.md",
];

const orderedCommands = [
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run candidate:handoff-index-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-dry-run-record-check",
  "npm.cmd run candidate:maintainer-conversion-authorization-check",
  "npm.cmd run candidate:reviewer-workbench-check",
  "npm.cmd run phase30:review-session-package",
  "npm.cmd run candidate:reviewer-output-receipt-check",
  "npm.cmd run candidate:reviewer-output-summary-template-check",
  "npm.cmd run phase30:post-review-evidence-summary",
  "npm.cmd run phase30:human-evidence-conflict-review",
  "npm.cmd run phase30:risk-disposition-followup-ledger",
  "npm.cmd run phase30:live-submission-conversion-preflight",
  "npm.cmd run phase30:release-decision-readiness-envelope",
  "npm.cmd run phase30:release-approval-decision-packet",
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
  "npm.cmd run phase30:evidence-submission-gate",
];

const forbiddenApprovalMutations = [
  "releaseReady=true",
  "phase29ExitReady=true",
  "phase30EntryReady=true",
  "runtimeExecution",
  "thirdPartyExecution",
];

assert("candidate review execution sequence check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate review execution sequence check command",
  packageJson.scripts["candidate:review-execution-sequence-check"] ===
    "node scripts/candidate-review-execution-sequence-check.js"
);
assert(
  "check pipeline includes candidate review execution sequence check",
  packageJson.scripts.check.includes("node scripts/candidate-review-execution-sequence-check.js")
);

assert("review execution sequence document exists", fs.existsSync(sequencePath));
assert("review execution sequence is sequence-only", sequence.includes("review-execution-sequence-only"));
assert(
  "review execution sequence preserves candidate state",
  sequence.includes("rc-reviewable-but-not-releasable") &&
    sequence.includes("APP_VERSION=1.9.48") &&
    sequence.includes("PHASE=29")
);
assert(
  "review execution sequence keeps gates blocked",
  sequence.includes("releaseReady=false") &&
    sequence.includes("phase29ExitReady=false") &&
    sequence.includes("phase30EntryReady=false") &&
    sequence.includes("runtimeExecution=false") &&
    sequence.includes("thirdPartyExecution=false")
);
assert(
  "review execution sequence records missing evidence state",
  sequence.includes("liveSubmissionExists=false") &&
    sequence.includes("approvedSlots=0") &&
    sequence.includes("missingSlots=10")
);
assert("review execution sequence lists all ordered materials", orderedMaterials.every((item) => sequence.includes(item)));
assert("review execution sequence lists all ordered commands", orderedCommands.every((command) => sequence.includes(command)));
assert("review execution sequence covers all slots", requiredSlots.every((slot) => sequence.includes(slot)));
assert("review execution sequence requires reviewer fields", requiredFields.every((field) => sequence.includes(field)));
assert("review execution sequence requires followup fields", followupFields.every((field) => sequence.includes(field)));
assert(
  "review execution sequence protects live submission conversion",
  sequence.includes("data/phase30-human-evidence-submission.json") &&
    sequence.includes("维护者显式转换授权") &&
    sequence.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "review execution sequence says it is not approval",
  sequence.includes("不是 release approval") &&
    sequence.includes("不证明任何 reviewer 输出已经产生")
);
assert(
  "review execution sequence includes command checks",
  [
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
    "npm.cmd run candidate:reviewer-output-summary-template-check",
    "npm.cmd run candidate:reviewer-output-receipt-check",
    "npm.cmd run candidate:reviewer-workbench-check",
    "npm.cmd run candidate:pre-review-package-check",
    "npm.cmd run phase30:evidence-closure-status",
    "npm.cmd run check",
  ].every((command) => sequence.includes(command))
);
assert(
  "review execution sequence explicitly forbids approval mutations",
  forbiddenApprovalMutations.every((item) => sequence.includes(item))
);
assert("pre-review package links review execution sequence", preReview.includes("当前候选交付人工审查执行顺序总表.md"));
assert("receipt gate links review execution sequence", receiptGate.includes("当前候选交付人工审查执行顺序总表.md"));
assert("blocker clarification ledger links review execution sequence", blockerLedger.includes("当前候选交付人工审查执行顺序总表.md") || sequence.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("return resubmission closure record links review execution sequence", returnClosure.includes("当前候选交付人工审查执行顺序总表.md") || sequence.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("receipt attempt log links review execution sequence", receiptAttempt.includes("当前候选交付人工审查执行顺序总表.md") || sequence.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("field gap matrix links review execution sequence", fieldGapMatrix.includes("当前候选交付人工审查执行顺序总表.md") || sequence.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("field fix assignment links review execution sequence", assignment.includes("当前候选交付人工审查执行顺序总表.md") || sequence.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("field fix receipt retry readiness links review execution sequence", receiptReadiness.includes("当前候选交付人工审查执行顺序总表.md") || sequence.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("retry batch register links review execution sequence", retryBatch.includes("当前候选交付人工审查执行顺序总表.md") || sequence.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("summary template links review execution sequence", summaryTemplate.includes("当前候选交付人工审查执行顺序总表.md"));
assert("review execution sequence links review chain integrity index", sequence.includes("当前候选交付人工审查链完整性索引.md"));
assert("review execution sequence links review dry-run record template", sequence.includes("当前候选交付人工审查演练Dry-run记录模板.md"));
assert("review execution sequence links maintainer conversion authorization template", sequence.includes("当前候选交付维护者转换授权前置模板.md"));
assert("review execution sequence links negative misuse check", sequence.includes("当前候选交付负向用例防误用检查.md"));
assert("review execution sequence links final review package lock index", sequence.includes("当前候选交付人工审查包最终锁定索引.md"));
assert("review execution sequence links reviewer handoff execution checklist", sequence.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("review execution sequence links reviewer handoff receipt template", sequence.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("review execution sequence links reviewer review start confirmation template", sequence.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("review execution sequence links reviewer in-review blocker clarification ledger", sequence.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("review execution sequence links reviewer output return resubmission closure record", sequence.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("review execution sequence links reviewer output receipt attempt log", sequence.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("review execution sequence links reviewer output field gap matrix", sequence.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("review execution sequence links reviewer output field fix assignment", sequence.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("review execution sequence links reviewer output field fix receipt retry readiness", sequence.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("review execution sequence links reviewer output retry batch register", sequence.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert(
  "README links review execution sequence",
  readme.includes("Current candidate human review execution sequence") &&
    readme.includes("项目文档/当前候选交付人工审查执行顺序总表.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate review execution sequence checks passed.");
