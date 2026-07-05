const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");

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
const operations = readText(projectRoot, "src", "services", "operations.js");
const register = readText(docsRoot, "阶段30人工证据收集登记表.md");
const intakePlan = readText(docsRoot, "阶段30人工证据收集计划.md");
const rcFreeze = readText(docsRoot, "阶段30RC冻结清单.md");
const evidencePack = readText(docsRoot, "阶段30人工复核证据包.md");
const evidenceWorksheet = readText(docsRoot, "阶段30人工复核证据填写表.md");
const submissionGate = readText(docsRoot, "阶段30人工证据提交门禁.md");

assert("phase 30 evidence intake register does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 evidence intake register does not change version", packageJson.version === "1.9.48");
assert("package exposes phase 30 evidence intake register", packageJson.scripts["phase30:evidence-intake-register"] === "node scripts/phase30-evidence-intake-register.js");
assert("package exposes phase 30 evidence submission gate", packageJson.scripts["phase30:evidence-submission-gate"] === "node scripts/phase30-evidence-submission-gate.js");
assert("check pipeline includes phase 30 evidence intake register", packageJson.scripts.check.includes("node scripts/phase30-evidence-intake-register.js"));
assert("check pipeline includes phase 30 evidence submission gate", packageJson.scripts.check.includes("node scripts/phase30-evidence-submission-gate.js"));
assert("README declares phase 30 evidence intake register", readme.includes("Phase 30 human evidence intake register: active") && readme.includes("2.0.11 / phase30-human-evidence-intake-register"));
assert("register declares identity", register.includes("2.0.11 / phase30-human-evidence-intake-register") && register.includes("Phase 30 human evidence intake register: active"));
assert("register keeps all slots pending", register.includes("registerDisposition=pending") && register.includes("pendingSlots=10") && register.includes("approvedSlots=0"));
assert("register preserves guardrails", register.includes("releaseReady=false") && register.includes("phase29ExitReady=false") && register.includes("phase30EntryReady=false") && register.includes("runtimeExecution=false") && register.includes("thirdPartyExecution=false"));
assert("register keeps missing evidence fields", register.includes("evidenceRef=missing") && register.includes("reviewer=unassigned") && register.includes("reviewedAt=missing") && register.includes("decisionReason=missing") && register.includes("residualRisk=missing"));
assert("register defines reviewer intake fields", ["evidenceRef", "reviewer", "reviewedAt", "disposition", "decisionReason", "residualRisk", "followUpOwner", "recoveryCondition", "targetReviewDate"].every((field) => register.includes(field)));
assert("register forbids automatic approval", register.includes("no automatic approval") && register.includes("convert-check-pass-to-human-evidence") && register.includes("mark-releaseReady-true"));
assert("register references intake plan and worksheet", register.includes("阶段30人工证据收集计划.md") && register.includes("阶段30人工复核证据填写表.md"));
assert("register references submission gate", register.includes("阶段30人工证据提交门禁.md") && register.includes("phase30:evidence-submission-gate"));
assert("intake plan points to register", intakePlan.includes("阶段30人工证据收集登记表.md") && intakePlan.includes("2.0.11 / phase30-human-evidence-intake-register"));
assert("RC freeze points to register", rcFreeze.includes("阶段30人工证据收集登记表.md") && rcFreeze.includes("phase30:evidence-intake-register"));
assert("submission gate keeps live submission absent by default", submissionGate.includes("2.0.12 / phase30-human-evidence-submission-gate") && submissionGate.includes("submissionStatus=not-submitted"));
assert("evidence pack remains pending", evidencePack.includes("pendingSlots=10") && evidencePack.includes("approvedSlots=0"));
assert("evidence worksheet remains pending template", evidenceWorksheet.includes("pending") && evidenceWorksheet.includes("Phase 30 human review evidence worksheet is not human signoff"));
assert("operations ledger still keeps evidence pending", operations.includes("pendingSlots") && operations.includes("evidenceRef: \"missing\"") && operations.includes("reviewer: \"unassigned\""));

for (const evidenceId of requiredEvidenceIds) {
  assert(`register includes pending ${evidenceId}`, register.includes(`\`${evidenceId}\``) && register.includes("pending"));
  assert(`register preserves missing evidenceRef for ${evidenceId}`, register.includes(evidenceId) && register.includes("evidenceRef=missing"));
}

console.log("Phase 30 evidence intake register checks passed.");
