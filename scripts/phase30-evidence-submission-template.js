const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");
const samplePath = path.join(docsRoot, "阶段30人工证据提交样例.json");
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
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const register = readText(docsRoot, "阶段30人工证据收集登记表.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");

assert("phase 30 evidence submission template does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 evidence submission template does not change version", packageJson.version === "1.9.48");
assert("package exposes phase 30 evidence submission template", packageJson.scripts["phase30:evidence-submission-template"] === "node scripts/phase30-evidence-submission-template.js");
assert("check pipeline includes phase 30 evidence submission template", packageJson.scripts.check.includes("node scripts/phase30-evidence-submission-template.js"));
assert("README declares phase 30 evidence submission template", readme.includes("Phase 30 human evidence submission template: active") && readme.includes("2.0.13 / phase30-human-evidence-submission-template"));
assert("sample declares template identity", sample.templateBaseline === "2.0.13 / phase30-human-evidence-submission-template");
assert("sample is template only", sample.source === "template-only-not-human-submission" && sample.templateOnly === true);
assert("sample keeps automatic approval disabled", sample.noAutomaticApproval === true);
assert("sample keeps release and runtime blocked", sample.releaseReady === false && sample.phase29ExitReady === false && sample.phase30EntryReady === false && sample.runtimeExecution === false && sample.thirdPartyExecution === false);
assert("sample uses placeholder submission status", sample.submissionStatus === "template-not-submitted");
assert("sample contains all required records", Array.isArray(sample.records) && sample.records.length === requiredEvidenceIds.length);
assert("live human submission remains absent", !fs.existsSync(liveSubmissionPath));
assert("gate doc references sample template", gateDoc.includes("阶段30人工证据提交样例.json") && gateDoc.includes("phase30:evidence-submission-template"));
assert("register references sample template", register.includes("阶段30人工证据提交样例.json"));
assert("closure review references sample template", closureReview.includes("阶段30人工证据提交样例.json"));

const sampleIds = new Set(sample.records.map((record) => record.evidenceId));
for (const evidenceId of requiredEvidenceIds) {
  const record = sample.records.find((item) => item.evidenceId === evidenceId);
  assert(`sample includes ${evidenceId}`, sampleIds.has(evidenceId));
  assert(`sample ${evidenceId} keeps placeholder reviewer`, String(record.reviewer).startsWith("REPLACE_WITH_"));
  assert(`sample ${evidenceId} keeps placeholder evidenceRef`, String(record.evidenceRef).startsWith("REPLACE_WITH_"));
  assert(`sample ${evidenceId} keeps placeholder reviewedAt`, record.reviewedAt === "YYYY-MM-DD");
  assert(`sample ${evidenceId} keeps placeholder decisionReason`, String(record.decisionReason).startsWith("REPLACE_WITH_"));
  assert(`sample ${evidenceId} keeps placeholder residualRisk`, String(record.residualRisk).startsWith("REPLACE_WITH_"));
}

console.log("Phase 30 evidence submission template checks passed.");
