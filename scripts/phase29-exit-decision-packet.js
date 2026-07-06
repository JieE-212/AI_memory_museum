const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "\u9879\u76ee\u6587\u6863");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const allowedDecisions = ["exited", "rejected", "blocked", "hold"];
const requiredDecisionFields = [
  "phase29ExitDecision",
  "phase29ExitOwner",
  "phase29ExitReviewedAt",
  "phase29ExitEvidenceRef",
  "phase29ExitDecisionReason",
  "phase29ExitResidualRisk",
  "phase29ExitRollbackCondition",
  "phase29ExitScope",
  "phase29ExitExclusions",
  "phase29ExitFollowupOwner",
];

const checkItems = [
  "release-approval-recorded",
  "entry-redline-accepted",
  "blocker-clearance-complete",
  "transition-redline-resolved",
  "archive-integrity-verified",
  "docs-ownership-verified",
  "engineering-hygiene-reviewed",
  "phase29-exit-owner-decision-recorded",
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
const exitPacket = readText(docsRoot, "\u9636\u6bb529\u9000\u51fa\u51b3\u7b56\u5305.md");
const approvalPacket = readText(docsRoot, "\u9636\u6bb530\u53d1\u5e03\u5ba1\u6279\u51b3\u7b56\u5305.md");
const entryRedline = readText(docsRoot, "\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md");
const closureReview = readText(docsRoot, "\u9636\u6bb530\u6536\u53e3\u5ba1\u67e5\u5305.md");
const rcBrief = readText(docsRoot, "\u9636\u6bb530\u5019\u9009\u4ea4\u4ed8\u8bf4\u660e.md");
const hygiene = readText(docsRoot, "\u5de5\u7a0b\u536b\u751f\u6536\u53e3\u8bb0\u5f55.md");

assert("phase 29 exit decision packet does not change active phase", server.includes("const PHASE = 29"));
assert("phase 29 exit decision packet does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 29 exit decision packet",
  packageJson.scripts["phase29:exit-decision-packet"] === "node scripts/phase29-exit-decision-packet.js"
);
assert(
  "check pipeline includes phase 29 exit decision packet",
  packageJson.scripts.check.includes("node scripts/phase29-exit-decision-packet.js")
);
assert(
  "README declares phase 29 exit decision packet",
  readme.includes("Phase 29 exit decision packet: active") &&
    readme.includes("2.0.23 / phase29-exit-decision-packet")
);
assert(
  "exit packet declares identity",
  exitPacket.includes("2.0.23 / phase29-exit-decision-packet") &&
    exitPacket.includes("Phase 29 exit decision packet: active")
);
assert(
  "exit packet remains decision-packet only",
  exitPacket.includes("phase29ExitDecisionPacketOnly=true") &&
    exitPacket.includes("phase29-exit-decision-packet-only package") &&
    exitPacket.includes("This package is not release approval") &&
    exitPacket.includes("This package is not Phase 29 exit") &&
    exitPacket.includes("This package is not Phase 30 entry")
);
assert("exit packet keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "exit packet keeps exit blocked by default",
  exitPacket.includes("phase29ExitStatus=blocked-until-independent-exit-decision") &&
    exitPacket.includes("phase29ExitDecision=not-recorded") &&
    exitPacket.includes("releaseApprovalDecision=not-recorded")
);
assert(
  "exit packet preserves guardrails",
  exitPacket.includes("releaseReady=false") &&
    exitPacket.includes("phase29ExitReady=false") &&
    exitPacket.includes("phase30EntryReady=false") &&
    exitPacket.includes("runtimeExecution=false") &&
    exitPacket.includes("thirdPartyExecution=false") &&
    exitPacket.includes("persistedMutations=0")
);
assert(
  "exit packet inherits gate redline",
  exitPacket.includes("gateCascadeAllowed=false") &&
    exitPacket.includes("release-approval-to-phase29-exit") &&
    exitPacket.includes("phase29-exit-to-phase30-entry") &&
    exitPacket.includes("release approval 不自动触发 Phase 29 exit") &&
    exitPacket.includes("Phase 29 exit 不自动触发 Phase 30 entry")
);
assert(
  "approval packet references phase 29 exit packet",
  approvalPacket.includes("\u9636\u6bb529\u9000\u51fa\u51b3\u7b56\u5305.md") &&
    approvalPacket.includes("phase29:exit-decision-packet")
);
assert(
  "entry redline references phase 29 exit packet",
  entryRedline.includes("\u9636\u6bb529\u9000\u51fa\u51b3\u7b56\u5305.md") &&
    entryRedline.includes("phase29ExitDecisionPacketOnly=true")
);
assert(
  "closure review references phase 29 exit packet",
  closureReview.includes("\u9636\u6bb529\u9000\u51fa\u51b3\u7b56\u5305.md") &&
    closureReview.includes("phase29:exit-decision-packet")
);
assert(
  "release candidate brief references phase 29 exit packet",
  rcBrief.includes("\u9636\u6bb529\u9000\u51fa\u51b3\u7b56\u5305.md") &&
    rcBrief.includes("not Phase 30 entry")
);
assert(
  "engineering hygiene references phase 29 exit packet",
  hygiene.includes("\u9636\u6bb529\u9000\u51fa\u51b3\u7b56\u5305.md") &&
    hygiene.includes("phase29ExitDecisionPacketOnly=true")
);
assert(
  "project plan links phase 29 exit packet",
  plan.includes("\u9636\u6bb529\u9000\u51fa\u51b3\u7b56\u5305.md") &&
    plan.includes("2.0.23 / phase29-exit-decision-packet")
);
assert(
  "whitepaper explains phase 29 exit packet is not exit",
  whitepaper.includes("Phase 29 exit decision packet: active") &&
    whitepaper.includes("phase29-exit-decision-packet-only") &&
    whitepaper.includes("not Phase 29 exit")
);

for (const decision of allowedDecisions) {
  assert(`exit packet allows ${decision}`, exitPacket.includes(`\`${decision}\``));
}

for (const field of requiredDecisionFields) {
  assert(`exit packet requires ${field}`, exitPacket.includes(`\`${field}\``));
}

for (const item of checkItems) {
  assert(`exit packet includes check item ${item}`, exitPacket.includes(`\`${item}\``));
}

console.log("Phase 29 exit decision packet checks passed.");
