const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const integrityPath = path.join(docsDir, "当前候选交付人工审查链完整性索引.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const sequencePath = path.join(docsDir, "当前候选交付人工审查执行顺序总表.md");
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
const integrity = fs.readFileSync(integrityPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");

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

const chainMaterials = [
  "阶段30人工证据闭环状态审计.md",
  "当前候选交付审查前包索引.md",
  "当前候选交付人工审查执行顺序总表.md",
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
  "阶段30人工证据提交门禁.md",
];

const chainCommands = [
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run candidate:review-execution-sequence-check",
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
  "npm.cmd run phase30:reviewer-handoff",
  "npm.cmd run candidate:reviewer-workbench-check",
  "npm.cmd run phase30:review-session-package",
  "npm.cmd run candidate:reviewer-output-receipt-check",
  "npm.cmd run candidate:reviewer-output-summary-template-check",
  "npm.cmd run phase30:post-review-evidence-summary",
  "npm.cmd run phase30:human-evidence-conflict-review",
  "npm.cmd run phase30:risk-disposition-followup-ledger",
  "npm.cmd run phase30:live-submission-conversion-preflight",
  "npm.cmd run phase30:release-decision-readiness-envelope",
  "npm.cmd run phase30:evidence-submission-gate",
];

const candidateScripts = {
  "candidate:delivery-ui-check": "node scripts/candidate-delivery-ui-check.js",
  "candidate:user-path-check": "node scripts/candidate-user-path-check.js",
  "candidate:import-path-check": "node scripts/candidate-import-path-check.js",
  "candidate:handoff-index-check": "node scripts/candidate-handoff-index-check.js",
  "candidate:pre-review-package-check": "node scripts/candidate-pre-review-package-check.js",
  "candidate:reviewer-workbench-check": "node scripts/candidate-reviewer-workbench-check.js",
  "candidate:reviewer-output-receipt-check": "node scripts/candidate-reviewer-output-receipt-check.js",
  "candidate:reviewer-output-summary-template-check": "node scripts/candidate-reviewer-output-summary-template-check.js",
  "candidate:review-execution-sequence-check": "node scripts/candidate-review-execution-sequence-check.js",
  "candidate:review-chain-integrity-check": "node scripts/candidate-review-chain-integrity-check.js",
  "candidate:review-dry-run-record-check": "node scripts/candidate-review-dry-run-record-check.js",
  "candidate:maintainer-conversion-authorization-check": "node scripts/candidate-maintainer-conversion-authorization-check.js",
  "candidate:negative-misuse-check": "node scripts/candidate-negative-misuse-check.js",
  "candidate:final-review-package-lock-check": "node scripts/candidate-final-review-package-lock-check.js",
  "candidate:reviewer-handoff-execution-check": "node scripts/candidate-reviewer-handoff-execution-check.js",
  "candidate:reviewer-handoff-receipt-check": "node scripts/candidate-reviewer-handoff-receipt-check.js",
  "candidate:reviewer-review-start-confirmation-check": "node scripts/candidate-reviewer-review-start-confirmation-check.js",
  "candidate:reviewer-in-review-blocker-clarification-check": "node scripts/candidate-reviewer-in-review-blocker-clarification-check.js",
  "candidate:reviewer-output-return-resubmission-closure-check": "node scripts/candidate-reviewer-output-return-resubmission-closure-check.js",
  "candidate:reviewer-output-receipt-attempt-log-check": "node scripts/candidate-reviewer-output-receipt-attempt-log-check.js",
  "candidate:reviewer-output-field-gap-matrix-check": "node scripts/candidate-reviewer-output-field-gap-matrix-check.js",
  "candidate:reviewer-output-field-fix-assignment-check": "node scripts/candidate-reviewer-output-field-fix-assignment-check.js",
  "candidate:reviewer-output-field-fix-receipt-retry-readiness-check": "node scripts/candidate-reviewer-output-field-fix-receipt-retry-readiness-check.js",
  "candidate:reviewer-output-retry-batch-register-check": "node scripts/candidate-reviewer-output-retry-batch-register-check.js",
};

const requiredColumns = ["chain node", "material", "command", "upstream", "downstream", "allowed output", "must not"];

assert("candidate review chain integrity check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate review chain integrity check command",
  packageJson.scripts["candidate:review-chain-integrity-check"] ===
    "node scripts/candidate-review-chain-integrity-check.js"
);
assert(
  "check pipeline includes candidate review chain integrity check",
  packageJson.scripts.check.includes("node scripts/candidate-review-chain-integrity-check.js")
);
assert("review chain integrity index document exists", fs.existsSync(integrityPath));
assert("review chain integrity index is index-only", integrity.includes("review-chain-integrity-index-only"));
assert(
  "review chain integrity index preserves candidate state",
  integrity.includes("rc-reviewable-but-not-releasable") &&
    integrity.includes("APP_VERSION=1.9.48") &&
    integrity.includes("PHASE=29")
);
assert(
  "review chain integrity index keeps gates blocked",
  integrity.includes("releaseReady=false") &&
    integrity.includes("phase29ExitReady=false") &&
    integrity.includes("phase30EntryReady=false") &&
    integrity.includes("runtimeExecution=false") &&
    integrity.includes("thirdPartyExecution=false")
);
assert(
  "review chain integrity index records missing evidence state",
  integrity.includes("liveSubmissionExists=false") &&
    integrity.includes("approvedSlots=0") &&
    integrity.includes("missingSlots=10")
);
assert("review chain integrity index contains required matrix columns", requiredColumns.every((column) => integrity.includes(column)));
assert("review chain integrity index lists all chain materials", chainMaterials.every((item) => integrity.includes(item)));
assert("review chain integrity index lists all chain commands", chainCommands.every((command) => integrity.includes(command)));
assert("review chain integrity index covers all slots", requiredSlots.every((slot) => integrity.includes(slot)));
assert(
  "review chain integrity index protects live submission conversion",
  integrity.includes("data/phase30-human-evidence-submission.json") &&
    integrity.includes("不得在仓库保存真实 reviewer 输出") &&
    integrity.includes("维护者显式转换授权")
);
assert(
  "review chain integrity index says it is not approval",
  integrity.includes("不是 release approval") &&
    integrity.includes("不证明任何 reviewer 输出已经产生")
);
assert(
  "review chain integrity index includes command checks",
  [
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
    "npm.cmd run candidate:review-execution-sequence-check",
    "npm.cmd run candidate:reviewer-output-summary-template-check",
    "npm.cmd run candidate:reviewer-output-receipt-check",
    "npm.cmd run candidate:pre-review-package-check",
    "npm.cmd run phase30:evidence-closure-status",
    "npm.cmd run check",
  ].every((command) => integrity.includes(command))
);
assert(
  "package registers candidate review chain scripts",
  Object.entries(candidateScripts).every(([scriptName, command]) => packageJson.scripts[scriptName] === command)
);
assert(
  "check pipeline includes candidate review chain scripts",
  Object.values(candidateScripts).every((command) => packageJson.scripts.check.includes(command))
);
assert("pre-review package links review chain integrity index", preReview.includes("当前候选交付人工审查链完整性索引.md"));
assert("review execution sequence links review chain integrity index", sequence.includes("当前候选交付人工审查链完整性索引.md"));
assert("pre-review package links negative misuse check", preReview.includes("当前候选交付负向用例防误用检查.md"));
assert("review execution sequence links negative misuse check", sequence.includes("当前候选交付负向用例防误用检查.md"));
assert("pre-review package links final review package lock index", preReview.includes("当前候选交付人工审查包最终锁定索引.md"));
assert("review execution sequence links final review package lock index", sequence.includes("当前候选交付人工审查包最终锁定索引.md"));
assert("pre-review package links reviewer handoff execution checklist", preReview.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("review execution sequence links reviewer handoff execution checklist", sequence.includes("当前候选交付Reviewer实际交付执行清单.md"));
assert("pre-review package links reviewer handoff receipt template", preReview.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("review execution sequence links reviewer handoff receipt template", sequence.includes("当前候选交付Reviewer交付签收与退回回执模板.md"));
assert("pre-review package links reviewer review start confirmation template", preReview.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("review execution sequence links reviewer review start confirmation template", sequence.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("pre-review package links reviewer in-review blocker clarification ledger", preReview.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("review execution sequence links reviewer in-review blocker clarification ledger", sequence.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("pre-review package links reviewer output return resubmission closure record", preReview.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("review execution sequence links reviewer output return resubmission closure record", sequence.includes("当前候选交付Reviewer输出退回与补交闭环记录.md"));
assert("pre-review package links reviewer output receipt attempt log", preReview.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("review execution sequence links reviewer output receipt attempt log", sequence.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("pre-review package links reviewer output field gap matrix", preReview.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("review execution sequence links reviewer output field gap matrix", sequence.includes("当前候选交付Reviewer输出字段缺口定位矩阵.md"));
assert("pre-review package links reviewer output field fix assignment", preReview.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("review execution sequence links reviewer output field fix assignment", sequence.includes("当前候选交付Reviewer输出字段修复责任分派单.md"));
assert("pre-review package links reviewer output field fix receipt retry readiness", preReview.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("review execution sequence links reviewer output field fix receipt retry readiness", sequence.includes("当前候选交付Reviewer输出字段修复回执与重试准备记录.md"));
assert("pre-review package links reviewer output retry batch register", preReview.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("review execution sequence links reviewer output retry batch register", sequence.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert(
  "README links review chain integrity index",
  readme.includes("Current candidate human review chain integrity index") &&
    readme.includes("项目文档/当前候选交付人工审查链完整性索引.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate review chain integrity checks passed.");
