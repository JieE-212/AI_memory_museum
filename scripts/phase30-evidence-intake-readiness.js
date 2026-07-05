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
const operations = readText(projectRoot, "src", "services", "operations.js");
const packageJson = JSON.parse(readText(projectRoot, "package.json"));
const evidencePack = readText(docsRoot, "阶段30人工复核证据包.md");
const evidenceWorksheet = readText(docsRoot, "阶段30人工复核证据填写表.md");
const intakePlan = readText(docsRoot, "阶段30人工证据收集计划.md");
const rcFreeze = readText(docsRoot, "阶段30RC冻结清单.md");
const intakeRegister = readText(docsRoot, "阶段30人工证据收集登记表.md");
const submissionGate = readText(docsRoot, "阶段30人工证据提交门禁.md");

assert("phase 30 evidence intake does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 evidence intake does not change version", packageJson.version === "1.9.48");
assert("package exposes phase 30 evidence intake readiness", packageJson.scripts["phase30:evidence-intake-readiness"] === "node scripts/phase30-evidence-intake-readiness.js");
assert("package exposes phase 30 evidence intake register", packageJson.scripts["phase30:evidence-intake-register"] === "node scripts/phase30-evidence-intake-register.js");
assert("package exposes phase 30 evidence submission gate", packageJson.scripts["phase30:evidence-submission-gate"] === "node scripts/phase30-evidence-submission-gate.js");
assert("check pipeline includes phase 30 evidence intake readiness", packageJson.scripts.check.includes("node scripts/phase30-evidence-intake-readiness.js"));
assert("check pipeline includes phase 30 evidence intake register", packageJson.scripts.check.includes("node scripts/phase30-evidence-intake-register.js"));
assert("check pipeline includes phase 30 evidence submission gate", packageJson.scripts.check.includes("node scripts/phase30-evidence-submission-gate.js"));
assert("intake plan declares identity", intakePlan.includes("2.0.10 / phase30-human-evidence-intake-plan") && intakePlan.includes("Phase 30 human evidence intake plan: active"));
assert("intake plan keeps evidence pending", intakePlan.includes("currentDisposition=pending") && intakePlan.includes("evidenceRef=missing") && intakePlan.includes("reviewer=unassigned"));
assert("intake plan blocks release and runtime", intakePlan.includes("release approval") && intakePlan.includes("Phase 30 entry") && intakePlan.includes("runtime execution") && intakePlan.includes("third-party execution"));
assert("intake plan defines required fields", ["evidenceRef", "reviewer", "reviewedAt", "disposition", "decisionReason", "residualRisk"].every((field) => intakePlan.includes(field)));
assert("intake plan forbids automatic approval", intakePlan.includes("check pass") && intakePlan.includes("dry-run pass") && intakePlan.includes("closure review pass"));
assert("RC freeze points to intake plan", rcFreeze.includes("阶段30人工证据收集计划.md"));
assert("intake plan points to register", intakePlan.includes("阶段30人工证据收集登记表.md") && intakePlan.includes("2.0.11 / phase30-human-evidence-intake-register"));
assert("intake register keeps all slots pending", intakeRegister.includes("2.0.11 / phase30-human-evidence-intake-register") && intakeRegister.includes("pendingSlots=10") && intakeRegister.includes("approvedSlots=0"));
assert("intake plan points to submission gate", intakePlan.includes("阶段30人工证据提交门禁.md") && intakePlan.includes("2.0.12 / phase30-human-evidence-submission-gate"));
assert("submission gate remains not submitted", submissionGate.includes("submissionStatus=not-submitted") && submissionGate.includes("format-gate-ready-but-evidence-not-submitted"));
assert("evidence pack keeps all slots pending", evidencePack.includes("pendingSlots=10") && evidencePack.includes("approvedSlots=0") && evidencePack.includes("evidenceRef=missing"));
assert("operations ledger keeps all slots pending", operations.includes("pendingSlots") && operations.includes("evidenceRef: \"missing\"") && operations.includes("reviewer: \"unassigned\""));
assert("operations ledger remains no-signoff", operations.includes("readonly-human-review-execution-ledger-no-signoff"));

for (const evidenceId of requiredEvidenceIds) {
  assert(`intake plan includes ${evidenceId}`, intakePlan.includes(evidenceId));
  assert(`intake register includes ${evidenceId}`, intakeRegister.includes(evidenceId));
  assert(`worksheet includes pending ${evidenceId}`, evidenceWorksheet.includes(`\`${evidenceId}\``) && evidenceWorksheet.includes("pending"));
  assert(`evidence pack includes ${evidenceId}`, evidencePack.includes(evidenceId));
  assert(`operations ledger includes ${evidenceId}`, operations.includes(evidenceId));
}

console.log("Phase 30 evidence intake readiness checks passed.");
