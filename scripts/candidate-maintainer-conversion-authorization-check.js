const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const authorizationPath = path.join(docsDir, "当前候选交付维护者转换授权前置模板.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const sequencePath = path.join(docsDir, "当前候选交付人工审查执行顺序总表.md");
const integrityPath = path.join(docsDir, "当前候选交付人工审查链完整性索引.md");
const dryRunPath = path.join(docsDir, "当前候选交付人工审查演练Dry-run记录模板.md");
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
const authorization = fs.readFileSync(authorizationPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const dryRun = fs.readFileSync(dryRunPath, "utf8");

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

const authorizationFields = [
  "authorizationRequestId",
  "authorizationRequestedAt",
  "authorizationRequestedBy",
  "maintainer",
  "maintainerRole",
  "sourceSummaryRef",
  "sourceConflictReviewRef",
  "sourceRiskFollowupRef",
  "sourceConversionPreflightRef",
  "allSlotsAccountedFor",
  "allRequiredFieldsPresent",
  "unresolvedConflictCount",
  "openRiskFollowupCount",
  "placeholderCount",
  "dryRunOnlySourceCount",
  "maintainerConversionAuthorization",
  "authorizationDecision",
  "authorizationReason",
  "readyForLiveSubmissionCreation",
];

const decisions = [
  "authorized-for-conversion",
  "rejected",
  "blocked-by-missing-evidence",
  "blocked-by-conflict",
  "blocked-by-risk-followup",
  "blocked-by-placeholder",
  "blocked-by-dry-run-only-source",
];

const requiredReviewerFields = [
  "reviewer",
  "reviewedAt",
  "evidenceRef",
  "disposition",
  "decisionReason",
  "residualRisk",
];

const forbiddenPlaceholders = [
  "REPLACE_WITH_...",
  "YYYY-MM-DD",
  "pending",
  "missing",
  "unassigned",
];

const requiredMaterials = [
  "当前候选交付人工审查执行顺序总表.md",
  "当前候选交付人工审查链完整性索引.md",
  "当前候选交付人工审查演练Dry-run记录模板.md",
  "当前候选交付Reviewer输出接收门禁.md",
  "当前候选交付Reviewer输出离线汇总模板索引.md",
  "阶段30会后证据汇总包.md",
  "阶段30人工证据冲突审查包.md",
  "阶段30风险处置后续台账.md",
  "阶段30LiveSubmission转换预检包.md",
  "当前候选交付负向用例防误用检查.md",
];

assert("candidate maintainer conversion authorization check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate maintainer conversion authorization check command",
  packageJson.scripts["candidate:maintainer-conversion-authorization-check"] ===
    "node scripts/candidate-maintainer-conversion-authorization-check.js"
);
assert(
  "check pipeline includes candidate maintainer conversion authorization check",
  packageJson.scripts.check.includes("node scripts/candidate-maintainer-conversion-authorization-check.js")
);
assert("maintainer conversion authorization template exists", fs.existsSync(authorizationPath));
assert(
  "maintainer conversion authorization template is template-only",
  authorization.includes("maintainer-conversion-authorization-template-only")
);
assert(
  "maintainer conversion authorization template preserves candidate state",
  authorization.includes("rc-reviewable-but-not-releasable") &&
    authorization.includes("APP_VERSION=1.9.48") &&
    authorization.includes("PHASE=29")
);
assert(
  "maintainer conversion authorization template keeps gates blocked",
  authorization.includes("releaseReady=false") &&
    authorization.includes("phase29ExitReady=false") &&
    authorization.includes("phase30EntryReady=false") &&
    authorization.includes("runtimeExecution=false") &&
    authorization.includes("thirdPartyExecution=false")
);
assert(
  "maintainer conversion authorization template records missing evidence state",
  authorization.includes("liveSubmissionExists=false") &&
    authorization.includes("approvedSlots=0") &&
    authorization.includes("missingSlots=10")
);
assert(
  "maintainer conversion authorization template blocks default authorization",
  authorization.includes("maintainerConversionAuthorization=false") &&
    authorization.includes("readyForLiveSubmissionCreation=false") &&
    authorization.includes("authorizationTemplateOnly=true")
);
assert("maintainer conversion authorization template lists materials", requiredMaterials.every((item) => authorization.includes(item)));
assert("maintainer conversion authorization template lists fields", authorizationFields.every((field) => authorization.includes(field)));
assert("maintainer conversion authorization template lists decisions", decisions.every((decision) => authorization.includes(decision)));
assert("maintainer conversion authorization template covers all slots", requiredSlots.every((slot) => authorization.includes(slot)));
assert("maintainer conversion authorization template requires reviewer fields", requiredReviewerFields.every((field) => authorization.includes(field)));
assert("maintainer conversion authorization template forbids placeholders", forbiddenPlaceholders.every((item) => authorization.includes(item)));
assert(
  "maintainer conversion authorization template protects live submission conversion",
  authorization.includes("data/phase30-human-evidence-submission.json") &&
    authorization.includes("不是维护者授权本身") &&
    authorization.includes("不证明维护者已经授权")
);
assert(
  "maintainer conversion authorization template rejects false authorization sources",
  [
    "dry-run 通过",
    "会议记录",
    "conversion preflight 通过",
    "npm.cmd run check",
    "口头结论",
  ].every((item) => authorization.includes(item))
);
assert(
  "maintainer conversion authorization template includes command checks",
  [
    "npm.cmd run candidate:maintainer-conversion-authorization-check",
    "npm.cmd run candidate:review-dry-run-record-check",
    "npm.cmd run candidate:review-chain-integrity-check",
    "npm.cmd run candidate:review-execution-sequence-check",
    "npm.cmd run candidate:negative-misuse-check",
    "npm.cmd run phase30:live-submission-conversion-preflight",
    "npm.cmd run phase30:evidence-closure-status",
    "npm.cmd run check",
  ].every((command) => authorization.includes(command))
);
assert("pre-review package links maintainer conversion authorization template", preReview.includes("当前候选交付维护者转换授权前置模板.md"));
assert("review execution sequence links maintainer conversion authorization template", sequence.includes("当前候选交付维护者转换授权前置模板.md"));
assert("review chain integrity index links maintainer conversion authorization template", integrity.includes("当前候选交付维护者转换授权前置模板.md"));
assert("review dry-run record template links maintainer conversion authorization template", dryRun.includes("当前候选交付维护者转换授权前置模板.md"));
assert("maintainer conversion authorization template links negative misuse check", authorization.includes("当前候选交付负向用例防误用检查.md"));
assert(
  "README links maintainer conversion authorization template",
  readme.includes("Current candidate maintainer conversion authorization precondition template") &&
    readme.includes("项目文档/当前候选交付维护者转换授权前置模板.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate maintainer conversion authorization checks passed.");
