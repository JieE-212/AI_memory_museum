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

const requiredFields = [
  "reviewer",
  "reviewedAt",
  "evidenceRef",
  "disposition",
  "decisionReason",
  "residualRisk",
];

const riskFollowupFields = ["followUpOwner", "recoveryCondition", "targetReviewDate"];
const forbiddenPlaceholders = ["REPLACE_WITH_...", "YYYY-MM-DD", "pending", "missing", "unassigned"];

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
const preflight = readText(docsRoot, "阶段30LiveSubmission转换预检包.md");
const summaryPackage = readText(docsRoot, "阶段30会后证据汇总包.md");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");
const rcBrief = readText(docsRoot, "阶段30候选交付说明.md");

assert("phase 30 live submission conversion preflight does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 live submission conversion preflight does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 live submission conversion preflight",
  packageJson.scripts["phase30:live-submission-conversion-preflight"] ===
    "node scripts/phase30-live-submission-conversion-preflight.js"
);
assert(
  "check pipeline includes phase 30 live submission conversion preflight",
  packageJson.scripts.check.includes("node scripts/phase30-live-submission-conversion-preflight.js")
);
assert(
  "README declares phase 30 live submission conversion preflight",
  readme.includes("Phase 30 live submission conversion preflight: active") &&
    readme.includes("2.0.17 / phase30-live-submission-conversion-preflight")
);
assert(
  "preflight declares identity",
  preflight.includes("2.0.17 / phase30-live-submission-conversion-preflight") &&
    preflight.includes("Phase 30 live submission conversion preflight: active")
);
assert(
  "preflight remains preflight only",
  preflight.includes("preflightOnly=true") &&
    preflight.includes("preflight-only package") &&
    preflight.includes("This package is not live submission")
);
assert("preflight keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "preflight keeps conversion blocked by default",
  preflight.includes("conversionStatus=blocked-until-human-evidence-and-maintainer-approval") &&
    preflight.includes("当前结论：`conversion-blocked`")
);
assert(
  "preflight preserves guardrails",
  preflight.includes("releaseReady=false") &&
    preflight.includes("phase29ExitReady=false") &&
    preflight.includes("phase30EntryReady=false") &&
    preflight.includes("runtimeExecution=false") &&
    preflight.includes("thirdPartyExecution=false") &&
    preflight.includes("noAutomaticApproval=true")
);
assert(
  "preflight blocks automatic live submission creation",
  preflight.includes("不自动创建 `data/phase30-human-evidence-submission.json`") &&
    preflight.includes("maintainerConversionApproval=granted")
);
assert(
  "summary package references conversion preflight",
  summaryPackage.includes("阶段30LiveSubmission转换预检包.md") &&
    summaryPackage.includes("phase30:live-submission-conversion-preflight")
);
assert(
  "gate references conversion preflight",
  gateDoc.includes("阶段30LiveSubmission转换预检包.md") &&
    gateDoc.includes("preflight-only")
);
assert(
  "closure review references conversion preflight",
  closureReview.includes("阶段30LiveSubmission转换预检包.md") &&
    closureReview.includes("phase30:live-submission-conversion-preflight")
);
assert(
  "release candidate brief references conversion preflight",
  rcBrief.includes("阶段30LiveSubmission转换预检包.md") &&
    rcBrief.includes("不代表 release approval")
);

for (const field of requiredFields) {
  assert(`preflight requires ${field}`, preflight.includes(`\`${field}\``));
}

for (const field of riskFollowupFields) {
  assert(`preflight requires risk followup ${field}`, preflight.includes(`\`${field}\``));
}

for (const placeholder of forbiddenPlaceholders) {
  assert(`preflight forbids placeholder ${placeholder}`, preflight.includes(`\`${placeholder}\``));
}

for (const evidenceId of requiredEvidenceIds) {
  assert(`preflight includes ${evidenceId}`, preflight.includes(`\`${evidenceId}\``));
}

console.log("Phase 30 live submission conversion preflight checks passed.");
