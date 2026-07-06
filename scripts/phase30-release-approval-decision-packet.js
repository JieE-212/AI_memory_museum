const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "\u9879\u76ee\u6587\u6863");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const allowedDecisions = ["approved", "rejected", "blocked", "hold"];
const requiredDecisionFields = [
  "releaseApprovalDecision",
  "releaseApprovalOwner",
  "releaseApprovalReviewedAt",
  "releaseApprovalEvidenceRef",
  "releaseApprovalDecisionReason",
  "releaseApprovalResidualRisk",
  "releaseApprovalRollbackCondition",
  "releaseApprovalScope",
  "releaseApprovalExclusions",
  "releaseApprovalFollowupOwner",
];

const checkItems = [
  "live-submission-present",
  "submission-gate-valid",
  "release-readiness-envelope-reviewed",
  "entry-redline-accepted",
  "conflict-review-resolved",
  "risk-followup-complete",
  "release-owner-decision-recorded",
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
const plan = readText(docsRoot, "\u9879\u76ee\u89c4\u5212.md");
const whitepaper = readText(docsRoot, "\u9879\u76ee\u767d\u76ae\u4e66.md");
const approvalPacket = readText(docsRoot, "\u9636\u6bb530\u53d1\u5e03\u5ba1\u6279\u51b3\u7b56\u5305.md");
const releaseEnvelope = readText(docsRoot, "\u9636\u6bb530\u53d1\u5e03\u51b3\u7b56\u51c6\u5907\u4fe1\u5c01.md");
const entryRedline = readText(docsRoot, "\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md");
const closureReview = readText(docsRoot, "\u9636\u6bb530\u6536\u53e3\u5ba1\u67e5\u5305.md");
const rcBrief = readText(docsRoot, "\u9636\u6bb530\u5019\u9009\u4ea4\u4ed8\u8bf4\u660e.md");
const hygiene = readText(docsRoot, "\u5de5\u7a0b\u536b\u751f\u6536\u53e3\u8bb0\u5f55.md");

assert("phase 30 release approval decision packet does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 release approval decision packet does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 release approval decision packet",
  packageJson.scripts["phase30:release-approval-decision-packet"] ===
    "node scripts/phase30-release-approval-decision-packet.js"
);
assert(
  "check pipeline includes phase 30 release approval decision packet",
  packageJson.scripts.check.includes("node scripts/phase30-release-approval-decision-packet.js")
);
assert(
  "README declares phase 30 release approval decision packet",
  readme.includes("Phase 30 release approval decision packet: active") &&
    readme.includes("2.0.22 / phase30-release-approval-decision-packet")
);
assert(
  "approval packet declares identity",
  approvalPacket.includes("2.0.22 / phase30-release-approval-decision-packet") &&
    approvalPacket.includes("Phase 30 release approval decision packet: active")
);
assert(
  "approval packet remains decision-packet only",
  approvalPacket.includes("releaseApprovalDecisionPacketOnly=true") &&
    approvalPacket.includes("release-approval-decision-packet-only package") &&
    approvalPacket.includes("This package is not release approval") &&
    approvalPacket.includes("This package is not Phase 29 exit") &&
    approvalPacket.includes("This package is not Phase 30 entry")
);
assert("approval packet keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "approval packet keeps approval blocked by default",
  approvalPacket.includes("releaseApprovalStatus=blocked-until-release-owner-decision") &&
    approvalPacket.includes("releaseApprovalDecision=not-recorded") &&
    approvalPacket.includes("releaseDecisionReadiness=not-ready")
);
assert(
  "approval packet preserves guardrails",
  approvalPacket.includes("releaseReady=false") &&
    approvalPacket.includes("phase29ExitReady=false") &&
    approvalPacket.includes("phase30EntryReady=false") &&
    approvalPacket.includes("runtimeExecution=false") &&
    approvalPacket.includes("thirdPartyExecution=false") &&
    approvalPacket.includes("persistedMutations=0")
);
assert(
  "approval packet inherits entry redline",
  approvalPacket.includes("entryReadinessRedline=active") &&
    approvalPacket.includes("gateCascadeAllowed=false") &&
    approvalPacket.includes("release-approval-to-phase29-exit") &&
    approvalPacket.includes("release approval 不自动触发 Phase 29 exit")
);
assert(
  "release envelope references approval packet",
  releaseEnvelope.includes("\u9636\u6bb530\u53d1\u5e03\u5ba1\u6279\u51b3\u7b56\u5305.md") &&
    releaseEnvelope.includes("phase30:release-approval-decision-packet")
);
assert(
  "entry redline references approval packet",
  entryRedline.includes("\u9636\u6bb530\u53d1\u5e03\u5ba1\u6279\u51b3\u7b56\u5305.md") &&
    entryRedline.includes("releaseApprovalDecisionPacketOnly=true")
);
assert(
  "closure review references approval packet",
  closureReview.includes("\u9636\u6bb530\u53d1\u5e03\u5ba1\u6279\u51b3\u7b56\u5305.md") &&
    closureReview.includes("phase30:release-approval-decision-packet")
);
assert(
  "release candidate brief references approval packet",
  rcBrief.includes("\u9636\u6bb530\u53d1\u5e03\u5ba1\u6279\u51b3\u7b56\u5305.md") &&
    rcBrief.includes("not Phase 29 exit")
);
assert(
  "engineering hygiene references approval packet",
  hygiene.includes("\u9636\u6bb530\u53d1\u5e03\u5ba1\u6279\u51b3\u7b56\u5305.md") &&
    hygiene.includes("releaseApprovalDecisionPacketOnly=true")
);
assert(
  "project plan links approval packet",
  plan.includes("\u9636\u6bb530\u53d1\u5e03\u5ba1\u6279\u51b3\u7b56\u5305.md") &&
    plan.includes("2.0.22 / phase30-release-approval-decision-packet")
);
assert(
  "whitepaper explains approval packet is not approval",
  whitepaper.includes("Phase 30 release approval decision packet: active") &&
    whitepaper.includes("release-approval-decision-packet-only") &&
    whitepaper.includes("not release approval")
);

for (const decision of allowedDecisions) {
  assert(`approval packet allows ${decision}`, approvalPacket.includes(`\`${decision}\``));
}

for (const field of requiredDecisionFields) {
  assert(`approval packet requires ${field}`, approvalPacket.includes(`\`${field}\``));
}

for (const item of checkItems) {
  assert(`approval packet includes check item ${item}`, approvalPacket.includes(`\`${item}\``));
}

console.log("Phase 30 release approval decision packet checks passed.");
