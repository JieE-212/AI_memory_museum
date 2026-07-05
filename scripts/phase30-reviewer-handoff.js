const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const reviewerGroups = {
  "release owner": [
    "release-blocker-disposition",
    "transition-redline-disposition",
    "signoff-evidence-reconciliation",
    "release-runtime-separation",
  ],
  "runtime owner": ["runtime-owner-go-no-go", "rollback-strategy-review"],
  "security reviewer": ["sandbox-acceptance-review", "secret-boundary-review"],
  "data steward": ["private-memory-boundary-review"],
  "audit reviewer": ["audit-dry-run-review"],
};

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
const handoff = readText(docsRoot, "阶段30人工Reviewer交接包.md");
const template = readText(docsRoot, "阶段30人工证据提交样例.json");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");
const register = readText(docsRoot, "阶段30人工证据收集登记表.md");

assert("phase 30 reviewer handoff does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 reviewer handoff does not change version", packageJson.version === "1.9.48");
assert("package exposes phase 30 reviewer handoff", packageJson.scripts["phase30:reviewer-handoff"] === "node scripts/phase30-reviewer-handoff.js");
assert("check pipeline includes phase 30 reviewer handoff", packageJson.scripts.check.includes("node scripts/phase30-reviewer-handoff.js"));
assert("README declares phase 30 reviewer handoff", readme.includes("Phase 30 human reviewer handoff package: active") && readme.includes("2.0.14 / phase30-human-reviewer-handoff-package"));
assert("handoff declares identity", handoff.includes("2.0.14 / phase30-human-reviewer-handoff-package") && handoff.includes("Phase 30 human reviewer handoff package: active"));
assert("handoff is assignment-only", handoff.includes("handoffOnly=true") && (handoff.includes("not live submission") || handoff.includes("不是 live submission")));
assert("handoff keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert("handoff preserves guardrails", handoff.includes("releaseReady=false") && handoff.includes("phase29ExitReady=false") && handoff.includes("phase30EntryReady=false") && handoff.includes("runtimeExecution=false") && handoff.includes("thirdPartyExecution=false"));
assert("handoff references template and gate", handoff.includes("阶段30人工证据提交样例.json") && handoff.includes("阶段30人工证据提交门禁.md"));
assert("template remains template only", template.includes("template-only-not-human-submission") && template.includes("REPLACE_WITH_REAL_REVIEWER"));
assert("gate references reviewer handoff", gateDoc.includes("阶段30人工Reviewer交接包.md") && gateDoc.includes("phase30:reviewer-handoff"));
assert("register references reviewer handoff", register.includes("阶段30人工Reviewer交接包.md"));
assert("closure review references reviewer handoff", closureReview.includes("阶段30人工Reviewer交接包.md") && closureReview.includes("phase30:reviewer-handoff"));

for (const [role, evidenceIds] of Object.entries(reviewerGroups)) {
  assert(`handoff includes role ${role}`, handoff.includes(role));
  for (const evidenceId of evidenceIds) {
    assert(`handoff assigns ${evidenceId}`, handoff.includes(`\`${evidenceId}\``));
  }
}

console.log("Phase 30 reviewer handoff checks passed.");
