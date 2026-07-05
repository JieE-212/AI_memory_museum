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

const trackedDispositions = ["accepted-with-risk", "deferred-with-owner", "blocked"];
const passthroughDispositions = ["approved-with-evidence", "rejected"];
const followupFields = [
  "followupId",
  "evidenceId",
  "disposition",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
  "riskSeverity",
  "riskScope",
  "blockingScope",
  "reviewCadence",
  "escalationOwner",
  "closureEvidenceRef",
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
const followupLedger = readText(docsRoot, "阶段30风险处置后续台账.md");
const conflictReview = readText(docsRoot, "阶段30人工证据冲突审查包.md");
const conversionPreflight = readText(docsRoot, "阶段30LiveSubmission转换预检包.md");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");
const rcBrief = readText(docsRoot, "阶段30候选交付说明.md");

assert("phase 30 risk disposition followup ledger does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 risk disposition followup ledger does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 risk disposition followup ledger",
  packageJson.scripts["phase30:risk-disposition-followup-ledger"] ===
    "node scripts/phase30-risk-disposition-followup-ledger.js"
);
assert(
  "check pipeline includes phase 30 risk disposition followup ledger",
  packageJson.scripts.check.includes("node scripts/phase30-risk-disposition-followup-ledger.js")
);
assert(
  "README declares phase 30 risk disposition followup ledger",
  readme.includes("Phase 30 risk disposition followup ledger: active") &&
    readme.includes("2.0.19 / phase30-risk-disposition-followup-ledger")
);
assert(
  "followup ledger declares identity",
  followupLedger.includes("2.0.19 / phase30-risk-disposition-followup-ledger") &&
    followupLedger.includes("Phase 30 risk disposition followup ledger: active")
);
assert(
  "followup ledger remains followup-ledger only",
  followupLedger.includes("followupLedgerOnly=true") &&
    followupLedger.includes("followup-ledger-only package") &&
    followupLedger.includes("This package is not live submission")
);
assert("followup ledger keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "followup ledger keeps risk disposition blocked by default",
  followupLedger.includes("riskDispositionStatus=blocked-until-human-followup-records") &&
    followupLedger.includes("followupTrackedSlots=0")
);
assert(
  "followup ledger preserves guardrails",
  followupLedger.includes("releaseReady=false") &&
    followupLedger.includes("phase29ExitReady=false") &&
    followupLedger.includes("phase30EntryReady=false") &&
    followupLedger.includes("runtimeExecution=false") &&
    followupLedger.includes("thirdPartyExecution=false") &&
    followupLedger.includes("noAutomaticApproval=true")
);
assert(
  "followup ledger blocks automatic live submission creation",
  followupLedger.includes("不自动创建 `data/phase30-human-evidence-submission.json`") &&
    followupLedger.includes("当前没有外部真实 reviewer 风险后续记录，因此风险处置后续台账默认阻断转换")
);
assert(
  "conflict review references followup ledger",
  conflictReview.includes("阶段30风险处置后续台账.md") &&
    conflictReview.includes("phase30:risk-disposition-followup-ledger")
);
assert(
  "conversion preflight references followup ledger",
  conversionPreflight.includes("阶段30风险处置后续台账.md") &&
    conversionPreflight.includes("followup-ledger-only")
);
assert(
  "gate references followup ledger",
  gateDoc.includes("阶段30风险处置后续台账.md") &&
    gateDoc.includes("followup-ledger-only")
);
assert(
  "closure review references followup ledger",
  closureReview.includes("阶段30风险处置后续台账.md") &&
    closureReview.includes("phase30:risk-disposition-followup-ledger")
);
assert(
  "release candidate brief references followup ledger",
  rcBrief.includes("阶段30风险处置后续台账.md") &&
    rcBrief.includes("不代表 release approval")
);

for (const disposition of trackedDispositions) {
  assert(`followup ledger tracks ${disposition}`, followupLedger.includes(`\`${disposition}\``));
}

for (const disposition of passthroughDispositions) {
  assert(`followup ledger names passthrough ${disposition}`, followupLedger.includes(`\`${disposition}\``));
}

for (const field of followupFields) {
  assert(`followup ledger requires ${field}`, followupLedger.includes(`\`${field}\``));
}

for (const evidenceId of requiredEvidenceIds) {
  assert(`followup ledger includes ${evidenceId}`, followupLedger.includes(`\`${evidenceId}\``));
}

console.log("Phase 30 risk disposition followup ledger checks passed.");
