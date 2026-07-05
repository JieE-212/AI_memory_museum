const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const requiredRoles = ["release owner", "runtime owner", "security reviewer", "data steward", "audit reviewer"];
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
const sessionPackage = readText(docsRoot, "阶段30人工审查会议包.md");
const handoff = readText(docsRoot, "阶段30人工Reviewer交接包.md");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const template = readText(docsRoot, "阶段30人工证据提交样例.json");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");

assert("phase 30 review session package does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 review session package does not change version", packageJson.version === "1.9.48");
assert("package exposes phase 30 review session package", packageJson.scripts["phase30:review-session-package"] === "node scripts/phase30-review-session-package.js");
assert("check pipeline includes phase 30 review session package", packageJson.scripts.check.includes("node scripts/phase30-review-session-package.js"));
assert("README declares phase 30 review session package", readme.includes("Phase 30 human review session package: active") && readme.includes("2.0.15 / phase30-human-review-session-package"));
assert("session package declares identity", sessionPackage.includes("2.0.15 / phase30-human-review-session-package") && sessionPackage.includes("Phase 30 human review session package: active"));
assert("session package is meeting-only", sessionPackage.includes("meetingOnly=true") && sessionPackage.includes("not live submission"));
assert("session package keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert("session package preserves guardrails", sessionPackage.includes("releaseReady=false") && sessionPackage.includes("phase29ExitReady=false") && sessionPackage.includes("phase30EntryReady=false") && sessionPackage.includes("runtimeExecution=false") && sessionPackage.includes("thirdPartyExecution=false"));
assert("session package references handoff gate and template", sessionPackage.includes("阶段30人工Reviewer交接包.md") && sessionPackage.includes("阶段30人工证据提交门禁.md") && sessionPackage.includes("阶段30人工证据提交样例.json"));
assert("handoff references review session package", handoff.includes("阶段30人工审查会议包.md") && handoff.includes("phase30:review-session-package"));
assert("gate references review session package", gateDoc.includes("阶段30人工审查会议包.md"));
assert("closure review references review session package", closureReview.includes("阶段30人工审查会议包.md") && closureReview.includes("phase30:review-session-package"));
assert("template remains template only", template.includes("template-only-not-human-submission") && template.includes("REPLACE_WITH_REAL_REVIEWER"));

for (const role of requiredRoles) {
  assert(`session package includes role ${role}`, sessionPackage.includes(role));
}

for (const evidenceId of requiredEvidenceIds) {
  assert(`session package includes ${evidenceId}`, sessionPackage.includes(`\`${evidenceId}\``));
}

console.log("Phase 30 human review session package checks passed.");
