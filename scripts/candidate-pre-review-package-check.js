const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
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
  "audit-dry-run-review"
];

const requiredCommands = [
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run candidate:delivery-ui-check",
  "npm.cmd run candidate:user-path-check",
  "npm.cmd run candidate:import-path-check",
  "npm.cmd run candidate:handoff-index-check",
  "npm.cmd run candidate:pre-review-package-check",
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
  "npm.cmd run check"
];

assert("candidate pre-review package check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate pre-review package check command",
  packageJson.scripts["candidate:pre-review-package-check"] === "node scripts/candidate-pre-review-package-check.js"
);
assert(
  "check pipeline includes candidate pre-review package check",
  packageJson.scripts.check.includes("node scripts/candidate-pre-review-package-check.js")
);

assert("pre-review package index document exists", fs.existsSync(preReviewPath));
assert("pre-review package is package-only", preReview.includes("pre-review-package-only"));
assert("pre-review package preserves candidate state", preReview.includes("rc-reviewable-but-not-releasable") && preReview.includes("APP_VERSION=1.9.48") && preReview.includes("PHASE=29"));
assert("pre-review package keeps gates blocked", preReview.includes("releaseReady=false") && preReview.includes("phase29ExitReady=false") && preReview.includes("phase30EntryReady=false") && preReview.includes("runtimeExecution=false") && preReview.includes("thirdPartyExecution=false"));
assert("pre-review package records evidence gap", preReview.includes("approvedSlots=0") && preReview.includes("missingSlots=10") && preReview.includes("liveSubmissionExists=false"));
assert("pre-review package lists all evidence slots", requiredSlots.every((slot) => preReview.includes(slot)));
assert("pre-review package lists required reviewer fields", ["reviewer", "reviewedAt", "evidenceRef", "disposition", "decisionReason", "residualRisk"].every((field) => preReview.includes(field)));
assert("pre-review package includes reviewer reading order", ["README.md", "当前候选交付变更索引.md", "当前候选交付验收说明.md", "当前候选交付人工审查执行顺序总表.md", "当前候选交付人工审查链完整性索引.md", "当前候选交付人工审查演练Dry-run记录模板.md", "当前候选交付维护者转换授权前置模板.md", "当前候选交付负向用例防误用检查.md", "当前候选交付人工审查包最终锁定索引.md", "当前候选交付Reviewer实际交付执行清单.md", "当前候选交付Reviewer交付签收与退回回执模板.md", "当前候选交付Reviewer审查启动确认模板.md", "当前候选交付Reviewer审查中阻塞与澄清问题台账.md", "当前候选交付Reviewer输出退回与补交闭环记录.md", "当前候选交付Reviewer输出接收尝试记录.md", "当前候选交付Reviewer输出字段缺口定位矩阵.md", "当前候选交付Reviewer输出字段修复责任分派单.md", "当前候选交付Reviewer输出字段修复回执与重试准备记录.md", "当前候选交付Reviewer输出重试批次登记表.md", "阶段30人工Reviewer交接包.md", "当前候选交付Reviewer输出接收门禁.md", "当前候选交付Reviewer输出离线汇总模板索引.md", "阶段30人工证据闭环状态审计.md"].every((item) => preReview.includes(item)));
assert("pre-review package includes demo paths", ["普通用户路径", "维护者路径", "写入 SQLite", "同步数据库"].every((item) => preReview.includes(item)));
assert("pre-review package includes required commands", requiredCommands.every((command) => preReview.includes(command)));
assert("pre-review package protects live submission conversion", preReview.includes("不得创建 `data/phase30-human-evidence-submission.json`") && preReview.includes("维护者显式转换授权"));
assert("pre-review package says check pass is not approval", preReview.includes("不能解释为 reviewer 已批准") && preReview.includes("不表示任何 evidence slot 已通过人工审查"));
assert("README links pre-review package index", readme.includes("Current candidate pre-review package index") && readme.includes("项目文档/当前候选交付审查前包索引.md"));
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate pre-review package checks passed.");
