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
const summaryPackage = readText(docsRoot, "阶段30会后证据汇总包.md");
const sessionPackage = readText(docsRoot, "阶段30人工审查会议包.md");
const handoff = readText(docsRoot, "阶段30人工Reviewer交接包.md");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");
const rcBrief = readText(docsRoot, "阶段30候选交付说明.md");

assert("phase 30 post review summary does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 post review summary does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 post review evidence summary",
  packageJson.scripts["phase30:post-review-evidence-summary"] ===
    "node scripts/phase30-post-review-evidence-summary.js"
);
assert(
  "check pipeline includes phase 30 post review evidence summary",
  packageJson.scripts.check.includes("node scripts/phase30-post-review-evidence-summary.js")
);
assert(
  "README declares phase 30 post review evidence summary",
  readme.includes("Phase 30 post review evidence summary package: active") &&
    readme.includes("2.0.16 / phase30-post-review-evidence-summary-package")
);
assert(
  "summary package declares identity",
  summaryPackage.includes("2.0.16 / phase30-post-review-evidence-summary-package") &&
    summaryPackage.includes("Phase 30 post review evidence summary package: active")
);
assert(
  "summary package is summary-only",
  summaryPackage.includes("summaryOnly=true") &&
    summaryPackage.includes("summary-only package") &&
    summaryPackage.includes("not live submission")
);
assert("summary package keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "summary package preserves guardrails",
  summaryPackage.includes("releaseReady=false") &&
    summaryPackage.includes("phase29ExitReady=false") &&
    summaryPackage.includes("phase30EntryReady=false") &&
    summaryPackage.includes("runtimeExecution=false") &&
    summaryPackage.includes("thirdPartyExecution=false") &&
    summaryPackage.includes("noAutomaticApproval=true")
);
assert(
  "summary package blocks automatic live submission",
  summaryPackage.includes("liveSubmissionCreation=blocked-until-explicit-maintainer-action") &&
    summaryPackage.includes("不自动创建 `data/phase30-human-evidence-submission.json`")
);
assert(
  "summary package references upstream review materials",
  summaryPackage.includes("阶段30人工审查会议包.md") &&
    summaryPackage.includes("阶段30人工Reviewer交接包.md") &&
    summaryPackage.includes("阶段30人工证据提交门禁.md") &&
    summaryPackage.includes("阶段30人工证据提交样例.json")
);
assert(
  "review session references post review summary",
  sessionPackage.includes("阶段30会后证据汇总包.md") &&
    sessionPackage.includes("phase30:post-review-evidence-summary")
);
assert(
  "handoff references post review summary",
  handoff.includes("阶段30会后证据汇总包.md") && handoff.includes("phase30:post-review-evidence-summary")
);
assert(
  "gate references post review summary",
  gateDoc.includes("阶段30会后证据汇总包.md") && gateDoc.includes("summary-only")
);
assert(
  "closure review references post review summary",
  closureReview.includes("阶段30会后证据汇总包.md") &&
    closureReview.includes("phase30:post-review-evidence-summary")
);
assert(
  "release candidate brief references post review summary",
  rcBrief.includes("阶段30会后证据汇总包.md") &&
    rcBrief.includes("不代表 live submission")
);

for (const field of requiredFields) {
  assert(`summary package requires ${field}`, summaryPackage.includes(`\`${field}\``));
}

for (const evidenceId of requiredEvidenceIds) {
  assert(`summary package includes ${evidenceId}`, summaryPackage.includes(`\`${evidenceId}\``));
}

console.log("Phase 30 post review evidence summary package checks passed.");
