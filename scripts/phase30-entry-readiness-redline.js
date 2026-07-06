const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "\u9879\u76ee\u6587\u6863");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const requiredGateIds = [
  "release-decision-readiness",
  "release-approval",
  "phase29-exit",
  "phase30-entry",
  "runtime-go-no-go",
  "third-party-execution",
];

const requiredManualDecisions = [
  "releaseApprovalDecision",
  "phase29ExitDecision",
  "phase30EntryDecision",
  "runtimeGoNoGoDecision",
  "thirdPartyExecutionDecision",
];

const antiCascadeRules = [
  "release-readiness-to-release-approval",
  "release-approval-to-phase29-exit",
  "phase29-exit-to-phase30-entry",
  "phase30-entry-to-runtime-go",
  "runtime-go-to-third-party-execution",
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
const redline = readText(docsRoot, "\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md");
const releaseEnvelope = readText(docsRoot, "\u9636\u6bb530\u53d1\u5e03\u51b3\u7b56\u51c6\u5907\u4fe1\u5c01.md");
const closureReview = readText(docsRoot, "\u9636\u6bb530\u6536\u53e3\u5ba1\u67e5\u5305.md");
const rcBrief = readText(docsRoot, "\u9636\u6bb530\u5019\u9009\u4ea4\u4ed8\u8bf4\u660e.md");
const hygiene = readText(docsRoot, "\u5de5\u7a0b\u536b\u751f\u6536\u53e3\u8bb0\u5f55.md");

assert("phase 30 entry readiness redline does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 entry readiness redline does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 entry readiness redline",
  packageJson.scripts["phase30:entry-readiness-redline"] === "node scripts/phase30-entry-readiness-redline.js"
);
assert(
  "check pipeline includes phase 30 entry readiness redline",
  packageJson.scripts.check.includes("node scripts/phase30-entry-readiness-redline.js")
);
assert(
  "README declares phase 30 entry readiness redline",
  readme.includes("Phase 30 entry readiness redline: active") &&
    readme.includes("2.0.21 / phase30-entry-readiness-redline")
);
assert(
  "redline declares identity",
  redline.includes("2.0.21 / phase30-entry-readiness-redline") &&
    redline.includes("Phase 30 entry readiness redline: active")
);
assert(
  "redline remains redline-only",
  redline.includes("entryReadinessRedlineOnly=true") &&
    redline.includes("redline-only package") &&
    redline.includes("This package is not release approval") &&
    redline.includes("This package is not Phase 29 exit") &&
    redline.includes("This package is not Phase 30 entry") &&
    redline.includes("This package is not runtime go/no-go")
);
assert("redline keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "redline blocks gate cascading",
  redline.includes("gateCascadeAllowed=false") &&
    redline.includes("releaseDecisionReadiness=not-ready") &&
    redline.includes("releaseApprovalGate=blocked-until-independent-release-approval") &&
    redline.includes("phase29ExitGate=blocked-until-independent-exit-approval") &&
    redline.includes("phase30EntryGate=blocked-until-independent-entry-approval") &&
    redline.includes("runtimeGoNoGoGate=no-go-blocked") &&
    redline.includes("thirdPartyExecutionGate=blocked")
);
assert(
  "redline preserves guardrails",
  redline.includes("releaseReady=false") &&
    redline.includes("phase29ExitReady=false") &&
    redline.includes("phase30EntryReady=false") &&
    redline.includes("runtimeExecution=false") &&
    redline.includes("thirdPartyExecution=false") &&
    redline.includes("persistedMutations=0")
);
assert(
  "release envelope references entry readiness redline",
  releaseEnvelope.includes("\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md") &&
    releaseEnvelope.includes("phase30:entry-readiness-redline") &&
    releaseEnvelope.includes("gateCascadeAllowed=false")
);
assert(
  "closure review references entry readiness redline",
  closureReview.includes("\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md") &&
    closureReview.includes("phase30:entry-readiness-redline") &&
    closureReview.includes("entry-readiness-redline-only")
);
assert(
  "release candidate brief references entry readiness redline",
  rcBrief.includes("\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md") &&
    rcBrief.includes("does not cascade into Phase 30 entry")
);
assert(
  "engineering hygiene references entry readiness redline",
  hygiene.includes("\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md") &&
    hygiene.includes("gateCascadeAllowed=false")
);
assert(
  "project plan links entry readiness redline",
  plan.includes("\u9636\u6bb530\u5165\u53e3\u51c6\u5907\u7ea2\u7ebf.md") &&
    plan.includes("2.0.21 / phase30-entry-readiness-redline")
);
assert(
  "whitepaper explains entry readiness redline is not entry",
  whitepaper.includes("Phase 30 entry readiness redline: active") &&
    whitepaper.includes("entry-readiness-redline-only") &&
    whitepaper.includes("not Phase 30 entry")
);

for (const gateId of requiredGateIds) {
  assert(`redline includes gate ${gateId}`, redline.includes(`\`${gateId}\``));
}

for (const decision of requiredManualDecisions) {
  assert(`redline requires ${decision}`, redline.includes(`\`${decision}\``));
}

for (const rule of antiCascadeRules) {
  assert(`redline blocks ${rule}`, redline.includes(`\`${rule}\``));
}

console.log("Phase 30 entry readiness redline checks passed.");
