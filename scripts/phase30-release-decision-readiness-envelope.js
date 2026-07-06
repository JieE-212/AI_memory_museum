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

const allowedReadiness = ["not-ready", "ready-for-human-release-review", "blocked"];
const checkItems = [
  "evidence-summary-complete",
  "conversion-preflight-ready",
  "conflict-review-resolved",
  "risk-followup-complete",
  "submission-gate-valid",
  "release-owner-review-ready",
];

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
const envelope = readText(docsRoot, "阶段30发布决策准备信封.md");
const summaryPackage = readText(docsRoot, "阶段30会后证据汇总包.md");
const conversionPreflight = readText(docsRoot, "阶段30LiveSubmission转换预检包.md");
const conflictReview = readText(docsRoot, "阶段30人工证据冲突审查包.md");
const followupLedger = readText(docsRoot, "阶段30风险处置后续台账.md");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");
const rcBrief = readText(docsRoot, "阶段30候选交付说明.md");

assert("phase 30 release decision readiness envelope does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 release decision readiness envelope does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 release decision readiness envelope",
  packageJson.scripts["phase30:release-decision-readiness-envelope"] ===
    "node scripts/phase30-release-decision-readiness-envelope.js"
);
assert(
  "check pipeline includes phase 30 release decision readiness envelope",
  packageJson.scripts.check.includes("node scripts/phase30-release-decision-readiness-envelope.js")
);
assert(
  "README declares phase 30 release decision readiness envelope",
  readme.includes("Phase 30 release decision readiness envelope: active") &&
    readme.includes("2.0.20 / phase30-release-decision-readiness-envelope")
);
assert(
  "envelope declares identity",
  envelope.includes("2.0.20 / phase30-release-decision-readiness-envelope") &&
    envelope.includes("Phase 30 release decision readiness envelope: active")
);
assert(
  "envelope remains readiness-only",
  envelope.includes("readinessEnvelopeOnly=true") &&
    envelope.includes("readiness-envelope-only package") &&
    envelope.includes("This package is not release approval") &&
    envelope.includes("This package is not live submission")
);
assert("envelope keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "envelope keeps release decision not ready by default",
  envelope.includes("releaseDecisionReadiness=not-ready") &&
    envelope.includes("releaseDecisionStatus=blocked-until-human-release-review") &&
    envelope.includes("readyForHumanReleaseReview=false")
);
assert(
  "envelope preserves guardrails",
  envelope.includes("releaseReady=false") &&
    envelope.includes("phase29ExitReady=false") &&
    envelope.includes("phase30EntryReady=false") &&
    envelope.includes("runtimeExecution=false") &&
    envelope.includes("thirdPartyExecution=false")
);
assert(
  "envelope blocks release approval conversion",
  envelope.includes("不把 `ready-for-human-release-review` 当作 release approval") &&
    envelope.includes("不设置 `releaseReady=true`")
);
assert(
  "summary package references release decision envelope",
  summaryPackage.includes("阶段30发布决策准备信封.md") &&
    summaryPackage.includes("readiness-envelope-only")
);
assert(
  "conversion preflight references release decision envelope",
  conversionPreflight.includes("阶段30发布决策准备信封.md") &&
    conversionPreflight.includes("phase30:release-decision-readiness-envelope")
);
assert(
  "conflict review references release decision envelope",
  conflictReview.includes("阶段30发布决策准备信封.md") &&
    conflictReview.includes("readiness-envelope-only")
);
assert(
  "followup ledger references release decision envelope",
  followupLedger.includes("阶段30发布决策准备信封.md") &&
    followupLedger.includes("phase30:release-decision-readiness-envelope")
);
assert(
  "gate references release decision envelope",
  gateDoc.includes("阶段30发布决策准备信封.md") &&
    gateDoc.includes("readiness-envelope-only")
);
assert(
  "closure review references release decision envelope",
  closureReview.includes("阶段30发布决策准备信封.md") &&
    closureReview.includes("phase30:release-decision-readiness-envelope")
);
assert(
  "release candidate brief references release decision envelope",
  rcBrief.includes("阶段30发布决策准备信封.md") &&
    rcBrief.includes("不代表 release approval")
);

for (const readiness of allowedReadiness) {
  assert(`envelope allows ${readiness}`, envelope.includes(`\`${readiness}\``));
}

for (const item of checkItems) {
  assert(`envelope includes check item ${item}`, envelope.includes(`\`${item}\``));
}

for (const evidenceId of requiredEvidenceIds) {
  assert(`envelope includes ${evidenceId}`, envelope.includes(`\`${evidenceId}\``));
}

console.log("Phase 30 release decision readiness envelope checks passed.");
