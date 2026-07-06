const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "\u9879\u76ee\u6587\u6863");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const allowedDecisions = ["approve", "deny", "hold", "blocked"];
const requiredApprovalFields = [
  "thirdPartyExecutionDecision",
  "thirdPartyExecutionOwner",
  "thirdPartyExecutionReviewedAt",
  "thirdPartyExecutionEvidenceRef",
  "thirdPartyExecutionDecisionReason",
  "thirdPartyExecutionResidualRisk",
  "thirdPartyExecutionRollbackCondition",
  "thirdPartyExecutionScope",
  "thirdPartyExecutionExclusions",
  "thirdPartyExecutionFollowupOwner",
  "pluginId",
  "pluginManifestRef",
  "pluginPermissionProfile",
  "pluginSecretAccessDecision",
  "pluginPrivateMemoryAccessDecision",
  "pluginAuditPlanRef",
];

const checkItems = [
  "runtime-go-recorded",
  "plugin-manifest-reviewed",
  "plugin-permissions-reviewed",
  "secret-boundary-reviewed",
  "private-memory-boundary-reviewed",
  "audit-persistence-reviewed",
  "sandbox-fixture-reviewed",
  "rollback-strategy-reviewed",
  "plugin-owner-decision-recorded",
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
const boundary = readText(docsRoot, "\u9636\u6bb530\u7b2c\u4e09\u65b9\u6267\u884c\u5ba1\u6279\u8fb9\u754c.md");
const runtimePacket = readText(docsRoot, "\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u51b3\u7b56\u5305.md");
const entryRedline = readText(docsRoot, "\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md");
const goNoGoBoard = readText(docsRoot, "\u9636\u6bb530\u8fd0\u884c\u65f6GoNoGo\u770b\u677f.md");
const closureReview = readText(docsRoot, "\u9636\u6bb530\u6536\u53e3\u5ba1\u67e5\u5305.md");
const rcBrief = readText(docsRoot, "\u9636\u6bb530\u5019\u9009\u4ea4\u4ed8\u8bf4\u660e.md");
const hygiene = readText(docsRoot, "\u5de5\u7a0b\u536b\u751f\u6536\u53e3\u8bb0\u5f55.md");

assert("phase 30 third-party boundary does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 third-party boundary does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 third-party execution approval boundary",
  packageJson.scripts["phase30:third-party-execution-approval-boundary"] ===
    "node scripts/phase30-third-party-execution-approval-boundary.js"
);
assert(
  "check pipeline includes phase 30 third-party execution approval boundary",
  packageJson.scripts.check.includes("node scripts/phase30-third-party-execution-approval-boundary.js")
);
assert(
  "README declares phase 30 third-party execution approval boundary",
  readme.includes("Phase 30 third-party execution approval boundary: active") &&
    readme.includes("2.0.26 / phase30-third-party-execution-approval-boundary")
);
assert(
  "third-party boundary declares identity",
  boundary.includes("2.0.26 / phase30-third-party-execution-approval-boundary") &&
    boundary.includes("Phase 30 third-party execution approval boundary: active")
);
assert(
  "third-party boundary remains boundary only",
  boundary.includes("thirdPartyExecutionApprovalBoundaryOnly=true") &&
    boundary.includes("third-party-execution-approval-boundary-only package") &&
    boundary.includes("This package is not runtime execution approval") &&
    boundary.includes("This package is not third-party execution approval") &&
    boundary.includes("This package does not execute real third-party plugin code")
);
assert("third-party boundary keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "third-party boundary keeps execution blocked by default",
  boundary.includes("thirdPartyExecutionApprovalStatus=no-execution-blocked") &&
    boundary.includes("thirdPartyExecutionDecision=not-recorded") &&
    boundary.includes("runtimeGoNoGoDecision=not-recorded")
);
assert(
  "third-party boundary preserves guardrails",
  boundary.includes("releaseReady=false") &&
    boundary.includes("phase29ExitReady=false") &&
    boundary.includes("phase30EntryReady=false") &&
    boundary.includes("runtimeExecution=false") &&
    boundary.includes("thirdPartyExecution=false") &&
    boundary.includes("persistedMutations=0")
);
assert(
  "third-party boundary requires plugin-scoped approval",
  boundary.includes("perPluginApprovalRequired=true") &&
    boundary.includes("blanketPluginApprovalAllowed=false") &&
    boundary.includes("pluginScopedApprovalRequired=true") &&
    boundary.includes("third-party execution approval 必须绑定单个 `pluginId`")
);
assert(
  "third-party boundary inherits anti-cascade rules",
  boundary.includes("gateCascadeAllowed=false") &&
    boundary.includes("runtime-go-to-third-party-execution") &&
    boundary.includes("third-party-approval-to-runtime-execution") &&
    boundary.includes("runtime go/no-go 不自动触发 third-party execution") &&
    boundary.includes("third-party execution approval 不自动触发 runtime execution")
);
assert(
  "runtime packet references third-party boundary",
  runtimePacket.includes("\u9636\u6bb530\u7b2c\u4e09\u65b9\u6267\u884c\u5ba1\u6279\u8fb9\u754c.md") &&
    runtimePacket.includes("phase30:third-party-execution-approval-boundary")
);
assert(
  "entry redline references third-party boundary",
  entryRedline.includes("\u9636\u6bb530\u7b2c\u4e09\u65b9\u6267\u884c\u5ba1\u6279\u8fb9\u754c.md") &&
    entryRedline.includes("thirdPartyExecutionApprovalBoundaryOnly=true")
);
assert(
  "go/no-go board references third-party boundary",
  goNoGoBoard.includes("\u9636\u6bb530\u7b2c\u4e09\u65b9\u6267\u884c\u5ba1\u6279\u8fb9\u754c.md") &&
    goNoGoBoard.includes("thirdPartyExecutionApprovalStatus=no-execution-blocked")
);
assert(
  "closure review references third-party boundary",
  closureReview.includes("\u9636\u6bb530\u7b2c\u4e09\u65b9\u6267\u884c\u5ba1\u6279\u8fb9\u754c.md") &&
    closureReview.includes("phase30:third-party-execution-approval-boundary")
);
assert(
  "release candidate brief references third-party boundary",
  rcBrief.includes("\u9636\u6bb530\u7b2c\u4e09\u65b9\u6267\u884c\u5ba1\u6279\u8fb9\u754c.md") &&
    rcBrief.includes("not third-party execution approval")
);
assert(
  "engineering hygiene references third-party boundary",
  hygiene.includes("\u9636\u6bb530\u7b2c\u4e09\u65b9\u6267\u884c\u5ba1\u6279\u8fb9\u754c.md") &&
    hygiene.includes("thirdPartyExecutionApprovalBoundaryOnly=true")
);
assert(
  "project plan links third-party boundary",
  plan.includes("\u9636\u6bb530\u7b2c\u4e09\u65b9\u6267\u884c\u5ba1\u6279\u8fb9\u754c.md") &&
    plan.includes("2.0.26 / phase30-third-party-execution-approval-boundary")
);
assert(
  "whitepaper explains third-party boundary is not execution approval",
  whitepaper.includes("Phase 30 third-party execution approval boundary: active") &&
    whitepaper.includes("third-party-execution-approval-boundary-only") &&
    whitepaper.includes("not third-party execution approval")
);

for (const decision of allowedDecisions) {
  assert(`third-party boundary allows ${decision}`, boundary.includes(`\`${decision}\``));
}

for (const field of requiredApprovalFields) {
  assert(`third-party boundary requires ${field}`, boundary.includes(`\`${field}\``));
}

for (const item of checkItems) {
  assert(`third-party boundary includes check item ${item}`, boundary.includes(`\`${item}\``));
}

console.log("Phase 30 third-party execution approval boundary checks passed.");
