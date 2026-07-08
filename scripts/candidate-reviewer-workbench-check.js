const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const workbenchPath = path.join(docsDir, "当前候选交付Reviewer证据槽位工作台.md");
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
const workbench = fs.readFileSync(workbenchPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");

const roleSlots = {
  "release owner": [
    "release-blocker-disposition",
    "transition-redline-disposition",
    "signoff-evidence-reconciliation",
    "release-runtime-separation",
  ],
  "runtime owner": [
    "runtime-owner-go-no-go",
    "rollback-strategy-review",
  ],
  "security reviewer": [
    "sandbox-acceptance-review",
    "secret-boundary-review",
  ],
  "data steward": [
    "private-memory-boundary-review",
  ],
  "audit reviewer": [
    "audit-dry-run-review",
  ],
};

const requiredFields = [
  "reviewer",
  "reviewedAt",
  "evidenceRef",
  "disposition",
  "decisionReason",
  "residualRisk",
];

const allowedDispositions = [
  "approved-with-evidence",
  "accepted-with-risk",
  "deferred-with-owner",
  "rejected",
  "blocked",
];

const followupFields = [
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

assert("candidate reviewer workbench check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer workbench check command",
  packageJson.scripts["candidate:reviewer-workbench-check"] === "node scripts/candidate-reviewer-workbench-check.js"
);
assert(
  "check pipeline includes candidate reviewer workbench check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-workbench-check.js")
);

assert("reviewer workbench document exists", fs.existsSync(workbenchPath));
assert("reviewer workbench is workbench-only", workbench.includes("reviewer-workbench-only"));
assert("reviewer workbench preserves candidate state", workbench.includes("rc-reviewable-but-not-releasable") && workbench.includes("APP_VERSION=1.9.48") && workbench.includes("PHASE=29"));
assert("reviewer workbench keeps gates blocked", workbench.includes("releaseReady=false") && workbench.includes("phase29ExitReady=false") && workbench.includes("phase30EntryReady=false") && workbench.includes("runtimeExecution=false") && workbench.includes("thirdPartyExecution=false"));
assert("reviewer workbench records missing evidence state", workbench.includes("liveSubmissionExists=false") && workbench.includes("approvedSlots=0") && workbench.includes("missingSlots=10"));
assert("reviewer workbench maps all roles", Object.keys(roleSlots).every((role) => workbench.includes(role)));
assert("reviewer workbench maps all slots", Object.values(roleSlots).flat().every((slot) => workbench.includes(slot)));
assert("reviewer workbench lists required fields", requiredFields.every((field) => workbench.includes(field)));
assert("reviewer workbench lists allowed dispositions", allowedDispositions.every((value) => workbench.includes(value)));
assert("reviewer workbench lists followup fields", followupFields.every((field) => workbench.includes(field)));
assert("reviewer workbench references input materials", [
  "当前候选交付审查前包索引.md",
  "当前候选交付变更索引.md",
  "当前候选交付验收说明.md",
  "阶段30人工Reviewer交接包.md",
  "阶段30人工证据闭环状态审计.md",
].every((item) => workbench.includes(item)));
assert("reviewer workbench includes command checks", [
  "npm.cmd run candidate:reviewer-workbench-check",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
].every((command) => workbench.includes(command)));
assert("reviewer workbench protects live submission conversion", workbench.includes("data/phase30-human-evidence-submission.json") && workbench.includes("真实 reviewer 输出") && workbench.includes("维护者显式转换授权"));
assert("reviewer workbench says it is not approval", workbench.includes("不是 release approval") && workbench.includes("不证明任何 evidence slot 已经通过人工审查"));
assert("pre-review package links reviewer workbench", preReview.includes("当前候选交付Reviewer证据槽位工作台.md"));
assert("README links reviewer workbench", readme.includes("Current candidate reviewer evidence workbench") && readme.includes("项目文档/当前候选交付Reviewer证据槽位工作台.md"));
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer workbench checks passed.");
