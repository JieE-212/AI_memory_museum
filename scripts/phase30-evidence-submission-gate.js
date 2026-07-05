const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");
const submissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const requiredEvidence = [
  ["release-blocker-disposition", "release owner"],
  ["transition-redline-disposition", "release owner"],
  ["signoff-evidence-reconciliation", "release owner"],
  ["release-runtime-separation", "release owner"],
  ["runtime-owner-go-no-go", "runtime owner"],
  ["rollback-strategy-review", "runtime owner"],
  ["sandbox-acceptance-review", "security reviewer"],
  ["secret-boundary-review", "security reviewer"],
  ["private-memory-boundary-review", "data steward"],
  ["audit-dry-run-review", "audit reviewer"],
];

const allowedDispositions = new Set([
  "approved-with-evidence",
  "accepted-with-risk",
  "deferred-with-owner",
  "rejected",
  "blocked",
]);

const followUpDispositions = new Set(["accepted-with-risk", "deferred-with-owner", "blocked"]);

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

function isFilled(value) {
  return typeof value === "string" && value.trim() !== "" && !["missing", "unassigned", "pending"].includes(value.trim());
}

function validateSubmission(submission) {
  assert("submission declares human owned source", submission.source === "human-reviewer-submission");
  assert("submission declares no automatic approval", submission.noAutomaticApproval === true);
  assert("submission keeps release blocked", submission.releaseReady === false);
  assert("submission keeps phase 29 exit blocked", submission.phase29ExitReady === false);
  assert("submission keeps phase 30 entry blocked", submission.phase30EntryReady === false);
  assert("submission keeps runtime blocked", submission.runtimeExecution === false);
  assert("submission keeps third party execution blocked", submission.thirdPartyExecution === false);
  assert("submission contains evidence records", Array.isArray(submission.records));

  const recordsById = new Map();
  for (const record of submission.records) {
    assert("submission record has evidenceId", isFilled(record.evidenceId));
    assert(`submission record ${record.evidenceId} is unique`, !recordsById.has(record.evidenceId));
    recordsById.set(record.evidenceId, record);
  }

  for (const [evidenceId, owner] of requiredEvidence) {
    const record = recordsById.get(evidenceId);
    assert(`submission includes ${evidenceId}`, Boolean(record));
    assert(`${evidenceId} keeps expected owner`, record.owner === owner);
    assert(`${evidenceId} has reviewer`, isFilled(record.reviewer));
    assert(`${evidenceId} has reviewedAt`, /^\d{4}-\d{2}-\d{2}/.test(String(record.reviewedAt || "")));
    assert(`${evidenceId} has evidenceRef`, isFilled(record.evidenceRef));
    assert(`${evidenceId} has allowed disposition`, allowedDispositions.has(record.disposition));
    assert(`${evidenceId} has decisionReason`, isFilled(record.decisionReason));
    assert(`${evidenceId} has residualRisk`, isFilled(record.residualRisk));

    if (followUpDispositions.has(record.disposition)) {
      assert(`${evidenceId} has followUpOwner for risk or block`, isFilled(record.followUpOwner));
      assert(`${evidenceId} has recoveryCondition for risk or block`, isFilled(record.recoveryCondition));
      assert(`${evidenceId} has targetReviewDate for risk or block`, /^\d{4}-\d{2}-\d{2}/.test(String(record.targetReviewDate || "")));
    }
  }
}

const server = readText(projectRoot, "server.js");
const packageJson = JSON.parse(readText(projectRoot, "package.json"));
const readme = readText(projectRoot, "README.md");
const register = readText(docsRoot, "阶段30人工证据收集登记表.md");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");
const templateSample = readText(docsRoot, "阶段30人工证据提交样例.json");
const reviewSessionPackage = readText(docsRoot, "阶段30人工审查会议包.md");

assert("phase 30 evidence submission gate does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 evidence submission gate does not change version", packageJson.version === "1.9.48");
assert("package exposes phase 30 evidence submission gate", packageJson.scripts["phase30:evidence-submission-gate"] === "node scripts/phase30-evidence-submission-gate.js");
assert("package exposes phase 30 evidence submission template", packageJson.scripts["phase30:evidence-submission-template"] === "node scripts/phase30-evidence-submission-template.js");
assert("check pipeline includes phase 30 evidence submission gate", packageJson.scripts.check.includes("node scripts/phase30-evidence-submission-gate.js"));
assert("check pipeline includes phase 30 evidence submission template", packageJson.scripts.check.includes("node scripts/phase30-evidence-submission-template.js"));
assert("README declares phase 30 evidence submission gate", readme.includes("Phase 30 human evidence submission gate: active") && readme.includes("2.0.12 / phase30-human-evidence-submission-gate"));
assert("gate doc declares identity", gateDoc.includes("2.0.12 / phase30-human-evidence-submission-gate") && gateDoc.includes("Phase 30 human evidence submission gate: active"));
assert("gate doc defines live submission path", gateDoc.includes("data/phase30-human-evidence-submission.json"));
assert("gate doc keeps approval blocked", gateDoc.includes("releaseReady=false") && gateDoc.includes("phase30EntryReady=false") && gateDoc.includes("runtimeExecution=false"));
assert("gate doc declares no automatic approval", gateDoc.includes("noAutomaticApproval=true") && gateDoc.includes("format-valid-but-not-release-approval"));
assert("gate doc references template sample", gateDoc.includes("阶段30人工证据提交样例.json") && gateDoc.includes("phase30:evidence-submission-template"));
assert("gate doc references review session package", gateDoc.includes("阶段30人工审查会议包.md") && gateDoc.includes("phase30:review-session-package"));
assert("register points to submission gate", register.includes("阶段30人工证据提交门禁.md") && register.includes("phase30:evidence-submission-gate"));
assert("closure review points to submission gate", closureReview.includes("阶段30人工证据提交门禁.md") && closureReview.includes("phase30:evidence-submission-gate"));
assert("template sample remains template only", templateSample.includes('"templateOnly": true') && templateSample.includes('"source": "template-only-not-human-submission"'));
assert("review session package remains meeting only", reviewSessionPackage.includes("meetingOnly=true") && reviewSessionPackage.includes("not live submission"));

if (fs.existsSync(submissionPath)) {
  validateSubmission(JSON.parse(fs.readFileSync(submissionPath, "utf8")));
  console.log("Phase 30 evidence submission gate checks passed with a live human submission file.");
} else {
  assert("live human evidence submission is absent by default", !fs.existsSync(submissionPath));
  assert("absent submission keeps intake pending", register.includes("pendingSlots=10") && register.includes("approvedSlots=0"));
  console.log("Phase 30 evidence submission gate checks passed without a live human submission file.");
}
