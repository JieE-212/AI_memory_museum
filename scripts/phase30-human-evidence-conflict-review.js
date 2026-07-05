const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const requiredEvidenceIds = [
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

const conflictTypes = [
  "duplicate-evidence-id-conflict",
  "reviewer-identity-conflict",
  "disposition-conflict",
  "evidence-ref-conflict",
  "risk-followup-conflict",
  "release-runtime-boundary-conflict",
  "placeholder-conflict",
  "format-approval-conflict",
];

const resolutionFields = [
  "conflictId",
  "evidenceId",
  "conflictType",
  "detectedBy",
  "detectedAt",
  "resolutionOwner",
  "resolutionDecision",
  "resolutionReason",
  "supersededEvidenceRef",
  "acceptedEvidenceRef",
  "residualRisk",
];

const riskFollowupFields = ["followUpOwner", "recoveryCondition", "targetReviewDate"];

function readText(...parts) {
  return fs.readFileSync(path.join(...parts), "utf8");
}

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

const server = readText(projectRoot, "server.js");
const packageJson = JSON.parse(readText(projectRoot, "package.json"));
const readme = readText(projectRoot, "README.md");
const conflictReview = readText(docsRoot, "阶段30人工证据冲突审查包.md");
const conversionPreflight = readText(docsRoot, "阶段30LiveSubmission转换预检包.md");
const summaryPackage = readText(docsRoot, "阶段30会后证据汇总包.md");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");
const rcBrief = readText(docsRoot, "阶段30候选交付说明.md");

assert("phase 30 human evidence conflict review does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 human evidence conflict review does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 human evidence conflict review",
  packageJson.scripts["phase30:human-evidence-conflict-review"] ===
    "node scripts/phase30-human-evidence-conflict-review.js"
);
assert(
  "check pipeline includes phase 30 human evidence conflict review",
  packageJson.scripts.check.includes("node scripts/phase30-human-evidence-conflict-review.js")
);
assert(
  "README declares phase 30 human evidence conflict review",
  readme.includes("Phase 30 human evidence conflict review: active") &&
    readme.includes("2.0.18 / phase30-human-evidence-conflict-review")
);
assert(
  "conflict review declares identity",
  conflictReview.includes("2.0.18 / phase30-human-evidence-conflict-review") &&
    conflictReview.includes("Phase 30 human evidence conflict review: active")
);
assert(
  "conflict review remains conflict-review only",
  conflictReview.includes("conflictReviewOnly=true") &&
    conflictReview.includes("conflict-review-only package") &&
    conflictReview.includes("This package is not live submission")
);
assert("conflict review keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "conflict review keeps resolution blocked by default",
  conflictReview.includes("conflictResolutionStatus=blocked-until-human-resolution") &&
    conflictReview.includes("conflictResolvedSlots=0")
);
assert(
  "conflict review preserves guardrails",
  conflictReview.includes("releaseReady=false") &&
    conflictReview.includes("phase29ExitReady=false") &&
    conflictReview.includes("phase30EntryReady=false") &&
    conflictReview.includes("runtimeExecution=false") &&
    conflictReview.includes("thirdPartyExecution=false") &&
    conflictReview.includes("noAutomaticApproval=true")
);
assert(
  "conflict review blocks automatic live submission creation",
  conflictReview.includes("不自动创建 `data/phase30-human-evidence-submission.json`") &&
    conflictReview.includes("当前没有外部真实 reviewer 证据，因此冲突审查默认阻断转换")
);
assert(
  "conversion preflight references conflict review",
  conversionPreflight.includes("阶段30人工证据冲突审查包.md") &&
    conversionPreflight.includes("phase30:human-evidence-conflict-review")
);
assert(
  "summary package references conflict review",
  summaryPackage.includes("阶段30人工证据冲突审查包.md") &&
    summaryPackage.includes("conflict-review-only")
);
assert(
  "gate references conflict review",
  gateDoc.includes("阶段30人工证据冲突审查包.md") &&
    gateDoc.includes("conflict-review-only")
);
assert(
  "closure review references conflict review",
  closureReview.includes("阶段30人工证据冲突审查包.md") &&
    closureReview.includes("phase30:human-evidence-conflict-review")
);
assert(
  "release candidate brief references conflict review",
  rcBrief.includes("阶段30人工证据冲突审查包.md") &&
    rcBrief.includes("不代表 release approval")
);

for (const conflictType of conflictTypes) {
  assert(`conflict review defines ${conflictType}`, conflictReview.includes(`\`${conflictType}\``));
}

for (const field of resolutionFields) {
  assert(`conflict review requires ${field}`, conflictReview.includes(`\`${field}\``));
}

for (const field of riskFollowupFields) {
  assert(`conflict review requires risk followup ${field}`, conflictReview.includes(`\`${field}\``));
}

for (const evidenceId of requiredEvidenceIds) {
  assert(`conflict review includes ${evidenceId}`, conflictReview.includes(`\`${evidenceId}\``));
}

console.log("Phase 30 human evidence conflict review checks passed.");
