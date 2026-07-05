const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function readProject(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readWorkspace(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 22 readiness failed: ${name}`);
  }
  console.log(`ok - ${name}`);
}

const app = readProject("app.js");
const server = readProject("server.js");
const operations = readProject("src/services/operations.js");
const packageJson = readProject("package.json");
const apiSmoke = readProject("scripts/api-smoke.js");
const readme = readProject("README.md");
const whitepaper = readWorkspace("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");
const plan = readWorkspace("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");

assert("server preserves phase 22 under phase 29", server.includes("const PHASE = 29") && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package registers phase 22 readiness", packageJson.includes('"version": "1.9.48"') && packageJson.includes("phase22-readiness") && packageJson.includes("phase22:evidence-review") && packageJson.includes("phase22:review-workbench") && packageJson.includes("phase22:signoff-ledger") && packageJson.includes("phase22:release-blocker-rules") && packageJson.includes("phase22:blocker-clearance-plan") && packageJson.includes("phase22:release-readiness-decision") && packageJson.includes("phase22:clearance-audit-trail") && packageJson.includes("phase22:runtime-review-closure"));
assert("server exports phase 22 runtime evidence review", server.includes("buildPhase22RuntimeEvidenceReview") && server.includes("phase22RuntimeEvidenceReview") && server.includes("phase22.runtime-evidence-review.v1"));
assert("operations exports phase 22 runtime evidence review", operations.includes("buildPhase22RuntimeEvidenceReview") && operations.includes("phase22RuntimeEvidenceReview") && operations.includes("phase22.runtime-evidence-bundle.v1"));
assert("frontend has local phase 22 fallback", app.includes("buildLocalPhase22RuntimeEvidenceReview") && app.includes("phase22RuntimeEvidenceReview") && app.includes("phase22-runtime-review-closure"));
assert("phase 21 runtime sandbox plan remains preserved", server.includes("buildPhase21RuntimeSandboxPlan") && operations.includes("buildPhase21RuntimeSandboxPlan") && app.includes("buildLocalPhase21RuntimeSandboxPlan") && operations.includes("phase21.runtime-result-quarantine.v1"));
assert("phase 20 release gate evidence remains linked", server.includes("phase20PlatformPlan.pluginReleaseChecklistGate") && operations.includes("phase20PlatformPlan.pluginReleaseChecklistGate") && app.includes("phase20PlatformPlan.pluginReleaseChecklistGate"));
assert("third-party execution remains disabled", server.includes("thirdPartyExecution: false") && operations.includes("thirdPartyExecution: false") && app.includes("thirdPartyExecution: false"));
assert("runtime execution remains disabled", server.includes("runtimeExecution: false") && operations.includes("runtimeExecution: false") && app.includes("runtimeExecution: false"));
assert("evidence review bundle is modeled", operations.includes("evidenceBundle") && operations.includes("phase22.runtime-evidence-bundle.v1") && operations.includes("quarantine-items") && operations.includes("audit-replay-summary"));
assert("review workbench is modeled", operations.includes("reviewWorkbench") && operations.includes("phase22.runtime-review-workbench.v1") && operations.includes("read-only-disposition-model") && operations.includes("export-filtered-evidence"));
assert("review workbench exposes queue and panels", operations.includes("queueItems") && operations.includes("detailPanels") && operations.includes("reviewer-disposition") && operations.includes("open-review-workbench"));
assert("signoff ledger is modeled", operations.includes("signoffLedger") && operations.includes("phase22.review-signoff-ledger.v1") && operations.includes("append-only-model-no-runtime-release") && operations.includes("append-signoff-ledger-entry"));
assert("signoff ledger protects evidence snapshots", operations.includes("evidenceSnapshotPolicy") && operations.includes("before-disposition-write") && operations.includes("release-ready-false-while-blocked") && operations.includes("release-ready-true-with-blocker"));
assert("reviewer workflow is modeled", operations.includes("reviewerWorkflow") && operations.includes("record-reviewer-disposition") && operations.includes("derive-release-blockers") && operations.includes("export-review-audit"));
assert("review dispositions block unsafe runtime release", operations.includes("block-runtime-release") && operations.includes("request-output-contract-repair") && operations.includes("runtime-enabled-during-review"));
assert("audit export is modeled", operations.includes("phase22.runtime-review-audit-export.v1") && operations.includes("phase22-review-signoff-ledger.audit.json") && operations.includes("plugin-results-redacted-fixture-only"));
assert("release blocker rules are modeled", operations.includes("releaseBlockerRules") && operations.includes("phase22.release-blocker-rules.v1") && operations.includes("explainable-release-blocking-model"));
assert("release blocker rules explain clearance", operations.includes("severityLevels") && operations.includes("clearRequires") && operations.includes("releaseReadiness") && operations.includes("runtime-enabled-while-blocked"));
assert("release blocker clearance plan is modeled", operations.includes("releaseBlockerClearancePlan") && operations.includes("phase22.blocker-clearance-plan.v1") && operations.includes("human-owned-clearance-no-runtime-release"));
assert("release blocker clearance plan assigns evidence", operations.includes("ownerRoles") && operations.includes("requiredEvidence") && operations.includes("verificationSteps") && operations.includes("recompute-release-readiness"));
assert("release readiness decision is modeled", operations.includes("releaseReadinessDecision") && operations.includes("phase22.release-readiness-decision.v1") && operations.includes("derived-from-blocker-rules-and-clearance-plan"));
assert("release readiness decision blocks unsafe release", operations.includes("activeBlockers") && operations.includes("gates") && operations.includes("recomputePolicy") && operations.includes("releaseReady-true-with-active-blocker"));
assert("clearance audit trail is modeled", operations.includes("releaseClearanceAuditTrail") && operations.includes("phase22.clearance-audit-trail.v1") && operations.includes("append-only-clearance-attempts"));
assert("clearance audit trail protects failed clearance", operations.includes("verificationResults") && operations.includes("releaseReady-true-with-failed-clearance") && operations.includes("phase22-clearance-audit-trail.json"));
assert("runtime review closure is modeled", operations.includes("phase22RuntimeReviewClosure") && operations.includes("phase22.runtime-review-closure.v1") && operations.includes("phase22Complete: true") && operations.includes("nextPhaseEntryReady: true"));
assert("runtime review closure protects next phase entry", operations.includes("runtime-enabled-before-next-phase") && operations.includes("runtimeExecution=false") && operations.includes("thirdPartyExecution=false") && operations.includes("enter-next-phase"));
assert("release readiness remains blocked", operations.includes("releaseReady: false") && operations.includes("runtimeReady: false") && operations.includes("release-gate-blocked"));
assert("smoke covers phase 22 current version", apiSmoke.includes("version API reports phase 29") && apiSmoke.includes("operations API reports phase 29") && apiSmoke.includes("phase22.runtime-evidence-review.v1") && apiSmoke.includes("phase22.release-blocker-rules.v1") && apiSmoke.includes("phase22.blocker-clearance-plan.v1") && apiSmoke.includes("phase22.release-readiness-decision.v1") && apiSmoke.includes("phase22.clearance-audit-trail.v1") && apiSmoke.includes("phase22.runtime-review-closure.v1"));
assert("smoke covers phase 22 exports", apiSmoke.includes("version API exposes phase 22 runtime evidence review") && apiSmoke.includes("operations export includes phase 22 runtime evidence review") && apiSmoke.includes("export includes phase 22 runtime evidence review") && apiSmoke.includes("phase22.review-signoff-ledger.v1"));
assert("docs document phase 22 calibration", readme.includes("phase23-release-readiness-review-ui") && whitepaper.includes("phase23-release-readiness-review-ui") && plan.includes("phase23-release-readiness-review-ui") && readme.includes("phase22-runtime-review-closure"));

console.log("Phase 22 readiness checks passed.");

