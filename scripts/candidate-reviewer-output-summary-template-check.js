const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const summaryTemplatePath = path.join(docsDir, "当前候选交付Reviewer输出离线汇总模板索引.md");
const receiptGatePath = path.join(docsDir, "当前候选交付Reviewer输出接收门禁.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const postReviewPath = path.join(docsDir, "阶段30会后证据汇总包.md");
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
const summaryTemplate = fs.readFileSync(summaryTemplatePath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const postReview = fs.readFileSync(postReviewPath, "utf8");

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

const headerFields = [
  "summaryBundleRef",
  "summarizedAt",
  "summarizedBy",
  "sourceBundleRef",
  "receiptAcceptedByMaintainer",
  "slotCount",
  "acceptedSlotCount",
  "rejectedSlotCount",
  "conflictCount",
  "riskFollowupCount",
  "readyForPostReviewSummary",
  "readyForConversionPreflight",
];

const slotFields = [
  "evidenceId",
  "reviewerRole",
  "reviewer",
  "reviewedAt",
  "evidenceRef",
  "disposition",
  "decisionReason",
  "residualRisk",
  "receiptStatus",
  "summaryStatus",
  "conflictStatus",
  "riskFollowupStatus",
];

const allowedDispositions = [
  "approved-with-evidence",
  "accepted-with-risk",
  "deferred-with-owner",
  "rejected",
  "blocked",
];

const summaryStatuses = [
  "accepted-for-summary",
  "rejected-for-summary",
  "needs-conflict-review",
  "needs-risk-followup",
  "blocked",
];

const followupFields = [
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const forbiddenPlaceholders = [
  "REPLACE_WITH_...",
  "YYYY-MM-DD",
  "pending",
  "missing",
  "unassigned",
];

assert("candidate reviewer output summary template check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output summary template check command",
  packageJson.scripts["candidate:reviewer-output-summary-template-check"] ===
    "node scripts/candidate-reviewer-output-summary-template-check.js"
);
assert(
  "check pipeline includes candidate reviewer output summary template check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-summary-template-check.js")
);

assert("reviewer output summary template index exists", fs.existsSync(summaryTemplatePath));
assert("reviewer output summary template is template-only", summaryTemplate.includes("reviewer-output-summary-template-only"));
assert(
  "reviewer output summary template preserves candidate state",
  summaryTemplate.includes("rc-reviewable-but-not-releasable") &&
    summaryTemplate.includes("APP_VERSION=1.9.48") &&
    summaryTemplate.includes("PHASE=29")
);
assert(
  "reviewer output summary template keeps gates blocked",
  summaryTemplate.includes("releaseReady=false") &&
    summaryTemplate.includes("phase29ExitReady=false") &&
    summaryTemplate.includes("phase30EntryReady=false") &&
    summaryTemplate.includes("runtimeExecution=false") &&
    summaryTemplate.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output summary template records missing evidence state",
  summaryTemplate.includes("liveSubmissionExists=false") &&
    summaryTemplate.includes("approvedSlots=0") &&
    summaryTemplate.includes("missingSlots=10")
);
assert("reviewer output summary template lists all slots", requiredSlots.every((slot) => summaryTemplate.includes(slot)));
assert("reviewer output summary template lists header fields", headerFields.every((field) => summaryTemplate.includes(field)));
assert("reviewer output summary template lists slot fields", slotFields.every((field) => summaryTemplate.includes(field)));
assert(
  "reviewer output summary template lists allowed dispositions",
  allowedDispositions.every((value) => summaryTemplate.includes(value))
);
assert(
  "reviewer output summary template lists summary statuses",
  summaryStatuses.every((value) => summaryTemplate.includes(value))
);
assert("reviewer output summary template lists followup fields", followupFields.every((field) => summaryTemplate.includes(field)));
assert(
  "reviewer output summary template rejects placeholders",
  forbiddenPlaceholders.every((placeholder) => summaryTemplate.includes(placeholder))
);
assert(
  "reviewer output summary template references upstream and downstream materials",
  [
    "当前候选交付Reviewer证据槽位工作台.md",
    "当前候选交付Reviewer输出接收门禁.md",
    "阶段30会后证据汇总包.md",
    "阶段30人工证据冲突审查包.md",
    "阶段30风险处置后续台账.md",
    "阶段30LiveSubmission转换预检包.md",
  ].every((item) => summaryTemplate.includes(item))
);
assert(
  "reviewer output summary template protects live submission conversion",
  summaryTemplate.includes("data/phase30-human-evidence-submission.json") &&
    summaryTemplate.includes("维护者显式转换授权") &&
    summaryTemplate.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output summary template says it is not approval",
  summaryTemplate.includes("不是 release approval") &&
    summaryTemplate.includes("不证明任何 reviewer 输出已经被汇总")
);
assert(
  "reviewer output summary template includes command checks",
  [
    "npm.cmd run candidate:reviewer-output-summary-template-check",
    "npm.cmd run candidate:review-execution-sequence-check",
    "npm.cmd run candidate:reviewer-output-receipt-check",
    "npm.cmd run candidate:reviewer-workbench-check",
    "npm.cmd run candidate:pre-review-package-check",
    "npm.cmd run phase30:evidence-closure-status",
    "npm.cmd run check",
  ].every((command) => summaryTemplate.includes(command))
);
assert("reviewer output receipt gate links summary template", receiptGate.includes("当前候选交付Reviewer输出离线汇总模板索引.md"));
assert("pre-review package links summary template", preReview.includes("当前候选交付Reviewer输出离线汇总模板索引.md"));
assert("post review evidence summary links summary template", postReview.includes("当前候选交付Reviewer输出离线汇总模板索引.md"));
assert("summary template links review execution sequence", summaryTemplate.includes("当前候选交付人工审查执行顺序总表.md"));
assert(
  "README links summary template",
  readme.includes("Current candidate reviewer output offline summary template index") &&
    readme.includes("项目文档/当前候选交付Reviewer输出离线汇总模板索引.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output summary template checks passed.");
