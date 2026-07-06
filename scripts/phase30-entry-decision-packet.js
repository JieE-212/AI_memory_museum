const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "\u9879\u76ee\u6587\u6863");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const allowedDecisions = ["entered", "rejected", "blocked", "hold"];
const requiredDecisionFields = [
  "phase30EntryDecision",
  "phase30EntryOwner",
  "phase30EntryReviewedAt",
  "phase30EntryEvidenceRef",
  "phase30EntryDecisionReason",
  "phase30EntryResidualRisk",
  "phase30EntryRollbackCondition",
  "phase30EntryScope",
  "phase30EntryExclusions",
  "phase30EntryFollowupOwner",
];

const checkItems = [
  "phase29-exit-recorded",
  "entry-redline-accepted",
  "scope-lock-confirmed",
  "entry-baseline-reviewed",
  "runtime-boundary-reviewed",
  "secret-boundary-reviewed",
  "audit-boundary-reviewed",
  "human-evidence-reviewed",
  "phase30-entry-owner-decision-recorded",
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
const entryPacket = readText(docsRoot, "\u9636\u6bb530\u5165\u53e3\u51b3\u7b56\u5305.md");
const exitPacket = readText(docsRoot, "\u9636\u6bb529\u9000\u51fa\u51b3\u7b56\u5305.md");
const entryRedline = readText(docsRoot, "\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md");
const closureReview = readText(docsRoot, "\u9636\u6bb530\u6536\u53e3\u5ba1\u67e5\u5305.md");
const rcBrief = readText(docsRoot, "\u9636\u6bb530\u5019\u9009\u4ea4\u4ed8\u8bf4\u660e.md");
const hygiene = readText(docsRoot, "\u5de5\u7a0b\u536b\u751f\u6536\u53e3\u8bb0\u5f55.md");

assert("phase 30 entry decision packet does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 entry decision packet does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 entry decision packet",
  packageJson.scripts["phase30:entry-decision-packet"] === "node scripts/phase30-entry-decision-packet.js"
);
assert(
  "check pipeline includes phase 30 entry decision packet",
  packageJson.scripts.check.includes("node scripts/phase30-entry-decision-packet.js")
);
assert(
  "README declares phase 30 entry decision packet",
  readme.includes("Phase 30 entry decision packet: active") &&
    readme.includes("2.0.24 / phase30-entry-decision-packet")
);
assert(
  "entry packet declares identity",
  entryPacket.includes("2.0.24 / phase30-entry-decision-packet") &&
    entryPacket.includes("Phase 30 entry decision packet: active")
);
assert(
  "entry packet remains decision-packet only",
  entryPacket.includes("phase30EntryDecisionPacketOnly=true") &&
    entryPacket.includes("phase30-entry-decision-packet-only package") &&
    entryPacket.includes("This package is not Phase 29 exit") &&
    entryPacket.includes("This package is not Phase 30 entry") &&
    entryPacket.includes("This package is not runtime go/no-go")
);
assert("entry packet keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "entry packet keeps entry blocked by default",
  entryPacket.includes("phase30EntryStatus=blocked-until-independent-entry-decision") &&
    entryPacket.includes("phase30EntryDecision=not-recorded") &&
    entryPacket.includes("phase29ExitDecision=not-recorded")
);
assert(
  "entry packet preserves guardrails",
  entryPacket.includes("releaseReady=false") &&
    entryPacket.includes("phase29ExitReady=false") &&
    entryPacket.includes("phase30EntryReady=false") &&
    entryPacket.includes("runtimeExecution=false") &&
    entryPacket.includes("thirdPartyExecution=false") &&
    entryPacket.includes("persistedMutations=0")
);
assert(
  "entry packet inherits gate redline",
  entryPacket.includes("gateCascadeAllowed=false") &&
    entryPacket.includes("phase29-exit-to-phase30-entry") &&
    entryPacket.includes("phase30-entry-to-runtime-go") &&
    entryPacket.includes("Phase 29 exit 不自动触发 Phase 30 entry") &&
    entryPacket.includes("Phase 30 entry 不自动触发 runtime go/no-go")
);
assert(
  "exit packet references phase 30 entry packet",
  exitPacket.includes("\u9636\u6bb530\u5165\u53e3\u51b3\u7b56\u5305.md") &&
    exitPacket.includes("phase30:entry-decision-packet")
);
assert(
  "entry redline references phase 30 entry packet",
  entryRedline.includes("\u9636\u6bb530\u5165\u53e3\u51b3\u7b56\u5305.md") &&
    entryRedline.includes("phase30EntryDecisionPacketOnly=true")
);
assert(
  "closure review references phase 30 entry packet",
  closureReview.includes("\u9636\u6bb530\u5165\u53e3\u51b3\u7b56\u5305.md") &&
    closureReview.includes("phase30:entry-decision-packet")
);
assert(
  "release candidate brief references phase 30 entry packet",
  rcBrief.includes("\u9636\u6bb530\u5165\u53e3\u51b3\u7b56\u5305.md") &&
    rcBrief.includes("not runtime go/no-go")
);
assert(
  "engineering hygiene references phase 30 entry packet",
  hygiene.includes("\u9636\u6bb530\u5165\u53e3\u51b3\u7b56\u5305.md") &&
    hygiene.includes("phase30EntryDecisionPacketOnly=true")
);
assert(
  "project plan links phase 30 entry packet",
  plan.includes("\u9636\u6bb530\u5165\u53e3\u51b3\u7b56\u5305.md") &&
    plan.includes("2.0.24 / phase30-entry-decision-packet")
);
assert(
  "whitepaper explains phase 30 entry packet is not entry",
  whitepaper.includes("Phase 30 entry decision packet: active") &&
    whitepaper.includes("phase30-entry-decision-packet-only") &&
    whitepaper.includes("not Phase 30 entry")
);

for (const decision of allowedDecisions) {
  assert(`entry packet allows ${decision}`, entryPacket.includes(`\`${decision}\``));
}

for (const field of requiredDecisionFields) {
  assert(`entry packet requires ${field}`, entryPacket.includes(`\`${field}\``));
}

for (const item of checkItems) {
  assert(`entry packet includes check item ${item}`, entryPacket.includes(`\`${item}\``));
}

console.log("Phase 30 entry decision packet checks passed.");
