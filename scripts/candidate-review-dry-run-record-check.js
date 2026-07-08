const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const dryRunPath = path.join(docsDir, "当前候选交付人工审查演练Dry-run记录模板.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const sequencePath = path.join(docsDir, "当前候选交付人工审查执行顺序总表.md");
const integrityPath = path.join(docsDir, "当前候选交付人工审查链完整性索引.md");
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
const dryRun = fs.readFileSync(dryRunPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");

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
  "dryRunId",
  "dryRunAt",
  "dryRunBy",
  "sourceSequenceRef",
  "sourceIntegrityRef",
  "commandsPlanned",
  "commandsExecuted",
  "commandFailures",
  "blockedStepCount",
  "returnToReviewerCount",
  "misuseRiskCount",
  "dryRunConclusion",
];

const stepFields = [
  "dryRunStep",
  "materialRef",
  "commandRef",
  "expectedOutput",
  "actualDryRunObservation",
  "blocked",
  "blockerReason",
  "returnTarget",
  "nextRequiredAction",
];

const conclusions = [
  "ready-for-human-review-meeting",
  "blocked-by-missing-material",
  "blocked-by-command-failure",
  "blocked-by-sequence-gap",
  "blocked-by-misuse-risk",
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

const commands = [
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:maintainer-conversion-authorization-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:reviewer-workbench-check",
  "npm.cmd run candidate:reviewer-output-receipt-check",
  "npm.cmd run candidate:reviewer-output-summary-template-check",
  "npm.cmd run phase30:post-review-evidence-summary",
  "npm.cmd run phase30:human-evidence-conflict-review",
  "npm.cmd run phase30:risk-disposition-followup-ledger",
  "npm.cmd run phase30:live-submission-conversion-preflight",
  "npm.cmd run check",
];

assert("candidate review dry-run record check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate review dry-run record check command",
  packageJson.scripts["candidate:review-dry-run-record-check"] ===
    "node scripts/candidate-review-dry-run-record-check.js"
);
assert(
  "check pipeline includes candidate review dry-run record check",
  packageJson.scripts.check.includes("node scripts/candidate-review-dry-run-record-check.js")
);
assert("review dry-run record template exists", fs.existsSync(dryRunPath));
assert("review dry-run record template is template-only", dryRun.includes("review-dry-run-record-template-only"));
assert(
  "review dry-run record template preserves candidate state",
  dryRun.includes("rc-reviewable-but-not-releasable") &&
    dryRun.includes("APP_VERSION=1.9.48") &&
    dryRun.includes("PHASE=29")
);
assert(
  "review dry-run record template keeps gates blocked",
  dryRun.includes("releaseReady=false") &&
    dryRun.includes("phase29ExitReady=false") &&
    dryRun.includes("phase30EntryReady=false") &&
    dryRun.includes("runtimeExecution=false") &&
    dryRun.includes("thirdPartyExecution=false")
);
assert(
  "review dry-run record template records missing evidence state",
  dryRun.includes("liveSubmissionExists=false") &&
    dryRun.includes("approvedSlots=0") &&
    dryRun.includes("missingSlots=10")
);
assert(
  "review dry-run record template keeps dry-run blocked from conversion",
  dryRun.includes("dryRunOnly=true") &&
    dryRun.includes("receiptAcceptedByMaintainer=false") &&
    dryRun.includes("readyForPostReviewSummary=false") &&
    dryRun.includes("readyForConversionPreflight=false")
);
assert("review dry-run record template lists header fields", headerFields.every((field) => dryRun.includes(field)));
assert("review dry-run record template lists step fields", stepFields.every((field) => dryRun.includes(field)));
assert("review dry-run record template lists conclusions", conclusions.every((value) => dryRun.includes(value)));
assert("review dry-run record template lists required commands", commands.every((command) => dryRun.includes(command)));
assert("review dry-run record template covers all slots", requiredSlots.every((slot) => dryRun.includes(slot)));
assert("review dry-run record template requires reviewer fields", requiredFields.every((field) => dryRun.includes(field)));
assert("review dry-run record template requires followup fields", followupFields.every((field) => dryRun.includes(field)));
assert(
  "review dry-run record template protects live submission conversion",
  dryRun.includes("data/phase30-human-evidence-submission.json") &&
    dryRun.includes("不是 receipt acceptance") &&
    dryRun.includes("不是 release approval")
);
assert(
  "review dry-run record template says it is not evidence",
  dryRun.includes("不是 reviewer 输出") &&
    dryRun.includes("不证明任何 reviewer 输出已经产生")
);
assert(
  "review dry-run record template includes command checks",
  [
    "npm.cmd run candidate:review-dry-run-record-check",
    "npm.cmd run candidate:maintainer-conversion-authorization-check",
    "npm.cmd run candidate:review-chain-integrity-check",
    "npm.cmd run candidate:review-execution-sequence-check",
    "npm.cmd run candidate:negative-misuse-check",
    "npm.cmd run phase30:evidence-closure-status",
    "npm.cmd run check",
  ].every((command) => dryRun.includes(command))
);
assert("pre-review package links review dry-run record template", preReview.includes("当前候选交付人工审查演练Dry-run记录模板.md"));
assert("review execution sequence links review dry-run record template", sequence.includes("当前候选交付人工审查演练Dry-run记录模板.md"));
assert("review chain integrity index links review dry-run record template", integrity.includes("当前候选交付人工审查演练Dry-run记录模板.md"));
assert("review dry-run record template links maintainer conversion authorization template", dryRun.includes("当前候选交付维护者转换授权前置模板.md"));
assert("review dry-run record template links negative misuse check", dryRun.includes("当前候选交付负向用例防误用检查.md"));
assert(
  "README links review dry-run record template",
  readme.includes("Current candidate human review dry-run record template") &&
    readme.includes("项目文档/当前候选交付人工审查演练Dry-run记录模板.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate review dry-run record checks passed.");
