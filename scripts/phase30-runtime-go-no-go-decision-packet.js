const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "\u9879\u76ee\u6587\u6863");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const allowedDecisions = ["go", "no-go", "hold", "blocked"];
const requiredDecisionFields = [
  "runtimeGoNoGoDecision",
  "runtimeGoNoGoOwner",
  "runtimeGoNoGoReviewedAt",
  "runtimeGoNoGoEvidenceRef",
  "runtimeGoNoGoDecisionReason",
  "runtimeGoNoGoResidualRisk",
  "runtimeGoNoGoRollbackCondition",
  "runtimeGoNoGoScope",
  "runtimeGoNoGoExclusions",
  "runtimeGoNoGoFollowupOwner",
];

const checkItems = [
  "phase30-entry-recorded",
  "go-no-go-board-reviewed",
  "sandbox-acceptance-reviewed",
  "secret-boundary-reviewed",
  "audit-dry-run-reviewed",
  "private-memory-boundary-reviewed",
  "rollback-strategy-reviewed",
  "runtime-owner-decision-recorded",
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
const runtimePacket = readText(docsRoot, "\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md");
const entryPacket = readText(docsRoot, "\u9636\u6bb530\u5165\u53e3\u51b3\u7b56\u5305.md");
const entryRedline = readText(docsRoot, "\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md");
const goNoGoBoard = readText(docsRoot, "\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u770b\u677f.md");
const closureReview = readText(docsRoot, "\u9636\u6bb530\u6536\u53e3\u5ba1\u67e5\u5305.md");
const rcBrief = readText(docsRoot, "\u9636\u6bb530\u5019\u9009\u4ea4\u4ed8\u8bf4\u660e.md");
const hygiene = readText(docsRoot, "\u5de5\u7a0b\u536b\u751f\u6536\u53e3\u8bb0\u5f55.md");

assert("phase 30 runtime go/no-go decision packet does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 runtime go/no-go decision packet does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 runtime go/no-go decision packet",
  packageJson.scripts["phase30:runtime-go-no-go-decision-packet"] ===
    "node scripts/phase30-runtime-go-no-go-decision-packet.js"
);
assert(
  "check pipeline includes phase 30 runtime go/no-go decision packet",
  packageJson.scripts.check.includes("node scripts/phase30-runtime-go-no-go-decision-packet.js")
);
assert(
  "README declares phase 30 runtime go/no-go decision packet",
  readme.includes("Phase 30 runtime go/no-go decision packet: active") &&
    readme.includes("2.0.25 / phase30-runtime-go-no-go-decision-packet")
);
assert(
  "runtime packet declares identity",
  runtimePacket.includes("2.0.25 / phase30-runtime-go-no-go-decision-packet") &&
    runtimePacket.includes("Phase 30 runtime go/no-go decision packet: active")
);
assert(
  "runtime packet remains decision-packet only",
  runtimePacket.includes("runtimeGoNoGoDecisionPacketOnly=true") &&
    runtimePacket.includes("runtime-go-no-go-decision-packet-only package") &&
    runtimePacket.includes("This package is not Phase 30 entry") &&
    runtimePacket.includes("This package is not runtime execution approval") &&
    runtimePacket.includes("This package is not third-party execution approval")
);
assert("runtime packet keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "runtime packet keeps runtime blocked by default",
  runtimePacket.includes("runtimeGoNoGoStatus=no-go-blocked") &&
    runtimePacket.includes("runtimeGoNoGoDecision=not-recorded") &&
    runtimePacket.includes("phase30EntryDecision=not-recorded")
);
assert(
  "runtime packet preserves guardrails",
  runtimePacket.includes("releaseReady=false") &&
    runtimePacket.includes("phase29ExitReady=false") &&
    runtimePacket.includes("phase30EntryReady=false") &&
    runtimePacket.includes("runtimeExecution=false") &&
    runtimePacket.includes("thirdPartyExecution=false") &&
    runtimePacket.includes("persistedMutations=0")
);
assert(
  "runtime packet inherits gate redline",
  runtimePacket.includes("gateCascadeAllowed=false") &&
    runtimePacket.includes("phase30-entry-to-runtime-go") &&
    runtimePacket.includes("runtime-go-to-third-party-execution") &&
    runtimePacket.includes("Phase 30 entry 不自动触发 runtime go/no-go") &&
    runtimePacket.includes("runtime go/no-go 不自动触发 third-party execution")
);
assert(
  "entry packet references runtime go/no-go packet",
  entryPacket.includes("\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md") &&
    entryPacket.includes("phase30:runtime-go-no-go-decision-packet")
);
assert(
  "entry redline references runtime go/no-go packet",
  entryRedline.includes("\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md") &&
    entryRedline.includes("runtimeGoNoGoDecisionPacketOnly=true")
);
assert(
  "go/no-go board references runtime decision packet",
  goNoGoBoard.includes("\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md") &&
    goNoGoBoard.includes("phase30:runtime-go-no-go-decision-packet")
);
assert(
  "closure review references runtime decision packet",
  closureReview.includes("\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md") &&
    closureReview.includes("phase30:runtime-go-no-go-decision-packet")
);
assert(
  "release candidate brief references runtime decision packet",
  rcBrief.includes("\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md") &&
    rcBrief.includes("not third-party execution approval")
);
assert(
  "engineering hygiene references runtime decision packet",
  hygiene.includes("\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md") &&
    hygiene.includes("runtimeGoNoGoDecisionPacketOnly=true")
);
assert(
  "project plan links runtime decision packet",
  plan.includes("\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md") &&
    plan.includes("2.0.25 / phase30-runtime-go-no-go-decision-packet")
);
assert(
  "whitepaper explains runtime decision packet is not runtime approval",
  whitepaper.includes("Phase 30 runtime go/no-go decision packet: active") &&
    whitepaper.includes("runtime-go-no-go-decision-packet-only") &&
    whitepaper.includes("not runtime execution approval")
);

for (const decision of allowedDecisions) {
  assert(`runtime packet allows ${decision}`, runtimePacket.includes(`\`${decision}\``));
}

for (const field of requiredDecisionFields) {
  assert(`runtime packet requires ${field}`, runtimePacket.includes(`\`${field}\``));
}

for (const item of checkItems) {
  assert(`runtime packet includes check item ${item}`, runtimePacket.includes(`\`${item}\``));
}

console.log("Phase 30 runtime go/no-go decision packet checks passed.");
