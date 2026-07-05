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
    throw new Error(`Phase 23 readiness failed: ${name}`);
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

assert("server preserves phase 23 under phase 29", server.includes("const PHASE = 29") && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package registers phase 23 readiness", packageJson.includes('"version": "1.9.48"') && packageJson.includes("phase23-readiness") && packageJson.includes("phase23:release-readiness-review-ui") && packageJson.includes("phase23:clearance-audit-search") && packageJson.includes("phase23:decision-history-export") && packageJson.includes("phase23:blocker-detail-panels") && packageJson.includes("phase23:review-action-ledger") && packageJson.includes("phase23:next-phase-guardrail-dashboard") && packageJson.includes("phase23:runtime-sandbox-ui-plan") && packageJson.includes("phase23:runtime-sandbox-readonly-panels") && packageJson.includes("phase23:runtime-sandbox-panel-view-export") && packageJson.includes("phase23:closure-handoff-package"));
assert("server exports phase 23 review UI", server.includes("buildPhase23ReleaseReadinessReviewUi") && server.includes("phase23ReleaseReadinessReviewUi") && server.includes("phase23.release-readiness-review-ui.v1"));
assert("operations exports phase 23 review UI", operations.includes("buildPhase23ReleaseReadinessReviewUi") && operations.includes("phase23ReleaseReadinessReviewUi") && operations.includes("phase23.release-readiness-review-ui.v1"));
assert("frontend has local phase 23 fallback", app.includes("buildLocalPhase23ReleaseReadinessReviewUi") && app.includes("phase23ReleaseReadinessReviewUi") && app.includes("phase23-release-readiness-review-ui"));
assert("phase 22 closure remains the source", operations.includes("phase22RuntimeReviewClosure") && operations.includes("sourceClosure") && operations.includes("phase22RuntimeReviewClosure.phase22Complete=true"));
assert("runtime and third-party execution remain disabled", server.includes("runtimeExecution: false") && server.includes("thirdPartyExecution: false") && operations.includes("runtimeExecution: false") && app.includes("thirdPartyExecution: false"));
assert("review UI dashboard is modeled", operations.includes("dashboardCards") && operations.includes("release-decision") && operations.includes("active-blockers") && operations.includes("ready-under-guards"));
assert("review UI queues are modeled", operations.includes("reviewQueues") && operations.includes("active release blockers") && operations.includes("clearance audit attempts"));
assert("clearance audit search is modeled", operations.includes("clearanceAuditSearch") && operations.includes("phase23.clearance-audit-search.v1") && operations.includes("phase23-clearance-audit-search-results.json"));
assert("clearance audit search indexes failed clearance", operations.includes("queryFields") && operations.includes("indexedFields") && operations.includes("failed-clearance") && operations.includes("search-result-missing-decision-ref"));
assert("decision history export is modeled", operations.includes("decisionHistoryExport") && operations.includes("phase23.decision-history-export.v1") && operations.includes("phase23-release-decision-history.json"));
assert("decision history export preserves blockers", operations.includes("active-blockers-included") && operations.includes("releaseReady-true-in-export") && operations.includes("runtime-enabled-during-export"));
assert("blocker detail panels are modeled", operations.includes("blockerDetailPanels") && operations.includes("phase23.blocker-detail-panels.v1") && operations.includes("blocker-detail-panels-ready-runtime-disabled"));
assert("blocker detail panels preserve no-runtime guards", operations.includes("linkedAuditIds") && operations.includes("clearRequires") && operations.includes("mark-blocker-cleared") && operations.includes("runtime-enabled-from-detail"));
assert("review action ledger is modeled", operations.includes("reviewActionLedger") && operations.includes("phase23.review-action-ledger.v1") && operations.includes("append-only-review-actions-no-release-mutation"));
assert("review action ledger blocks release mutation", operations.includes("blocked-action-recorded-as-allowed") && operations.includes("releaseReady-true-in-action-ledger") && operations.includes("phase23-review-action-ledger.json"));
assert("next phase guardrail dashboard is modeled", operations.includes("nextPhaseGuardrailDashboard") && operations.includes("phase23.next-phase-guardrail-dashboard.v1") && operations.includes("separate-next-phase-entry-from-release-readiness"));
assert("next phase guardrail dashboard separates release block", operations.includes("next-phase-ready-release-blocked-runtime-disabled") && operations.includes("ship-third-party-plugin-runtime") && operations.includes("next-phase-entry-without-phase22-closure"));
assert("runtime sandbox UI plan is modeled", operations.includes("runtimeSandboxUiPlan") && operations.includes("phase23.runtime-sandbox-ui-plan.v1") && operations.includes("ui-planning-only-no-code-execution"));
assert("runtime sandbox UI plan blocks execution", operations.includes("phase23-runtime-sandbox-ui-plan.json") && operations.includes("run-third-party-plugin") && operations.includes("runtimeSandboxUiPlan-executes-code") && operations.includes("releaseReady-true-from-runtime-sandbox-ui-plan"));
assert("runtime sandbox read-only panels are modeled", operations.includes("runtimeSandboxReadOnlyPanels") && operations.includes("phase23.runtime-sandbox-readonly-panels.v1") && operations.includes("read-only-evidence-no-execution"));
assert("runtime sandbox read-only panels block execution", operations.includes("phase23-runtime-sandbox-readonly-panels.json") && operations.includes("execute-plugin-from-panel") && operations.includes("readOnlyPanel-executes-plugin-code") && operations.includes("releaseReady-true-from-readonly-panel"));
assert("runtime sandbox panel view export is modeled", operations.includes("runtimeSandboxPanelViewExport") && operations.includes("phase23.runtime-sandbox-panel-view-export.v1") && operations.includes("filtered-readonly-export-no-execution"));
assert("runtime sandbox panel view export is guarded", operations.includes("phase23-runtime-sandbox-panel-view-export.json") && operations.includes("export-plugin-output-payload") && operations.includes("panel-export-includes-runtime-output") && operations.includes("panel-export-marks-releaseReady-true"));
assert("phase 23 closure handoff package is modeled", operations.includes("phase23ClosureHandoffPackage") && operations.includes("phase23.closure-handoff-package.v1") && operations.includes("close-phase23-with-release-blockers-preserved"));
assert("phase 23 closure handoff package preserves blockers", operations.includes("phase23-closure-handoff-package.json") && operations.includes("phase24-runtime-sandbox-ux-implementation-plan") && operations.includes("handoff-marks-releaseReady-true") && operations.includes("handoff-drops-active-blockers"));
assert("review UI filters are modeled", operations.includes("filterModel") && operations.includes("show-blockers") && operations.includes("show-failed-clearance") && operations.includes("show-next-phase-guards"));
assert("review UI detail panels are modeled", operations.includes("detailPanels") && operations.includes("blocker-detail") && operations.includes("decision-history") && operations.includes("next-phase-entry-guards"));
assert("review UI action policy is guarded", operations.includes("allowedActions") && operations.includes("blockedActions") && operations.includes("mark-release-ready") && operations.includes("clear-blocker-without-evidence"));
assert("release readiness remains blocked", operations.includes("releaseReady: false") && operations.includes("releaseReady-true-with-active-blocker") && operations.includes("runtime-enabled-before-clearance"));
assert("smoke covers phase 23 current version", apiSmoke.includes("version API reports phase 29") && apiSmoke.includes("operations API reports phase 29") && apiSmoke.includes("phase23.release-readiness-review-ui.v1") && apiSmoke.includes("phase23.clearance-audit-search.v1") && apiSmoke.includes("phase23.decision-history-export.v1") && apiSmoke.includes("phase23.blocker-detail-panels.v1") && apiSmoke.includes("phase23.review-action-ledger.v1") && apiSmoke.includes("phase23.next-phase-guardrail-dashboard.v1") && apiSmoke.includes("phase23.runtime-sandbox-ui-plan.v1") && apiSmoke.includes("phase23.runtime-sandbox-readonly-panels.v1") && apiSmoke.includes("phase23.runtime-sandbox-panel-view-export.v1") && apiSmoke.includes("phase23.closure-handoff-package.v1"));
assert("smoke covers phase 23 exports", apiSmoke.includes("version API exposes phase 23 release readiness review UI") && apiSmoke.includes("operations export includes phase 23 release readiness review UI") && apiSmoke.includes("export includes phase 23 release readiness review UI"));
assert("docs document phase 23 calibration", readme.includes("phase23-release-readiness-review-ui") && whitepaper.includes("phase23-release-readiness-review-ui") && plan.includes("phase23-release-readiness-review-ui") && readme.includes("phase22-runtime-review-closure"));

console.log("Phase 23 readiness checks passed.");

