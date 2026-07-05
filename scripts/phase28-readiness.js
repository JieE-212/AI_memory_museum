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
    throw new Error(`Phase 28 readiness failed: ${name}`);
  }
  console.log(`ok - ${name}`);
}

const app = readProject("app.js");
const server = readProject("server.js");
const operations = readProject("src/services/operations.js");
const packageJson = readProject("package.json");
const apiSmoke = readProject("scripts/api-smoke.js");
const index = readProject("index.html");
const readme = readProject("README.md");
const whitepaper = readWorkspace("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");
const plan = readWorkspace("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");

assert("server reports phase 28 closure package", server.includes("const PHASE = 29") && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package registers phase 28 readiness", packageJson.includes('"version": "1.9.48"') && packageJson.includes("phase28-readiness") && packageJson.includes("phase28:clearance-review-entry") && packageJson.includes("phase28:evidence-intake-ledger") && packageJson.includes("phase28:reviewer-disposition-model") && packageJson.includes("phase28:clearance-criteria-checklist") && packageJson.includes("phase28:clearance-decision-preview") && packageJson.includes("phase28:closure-package"));
assert("server exposes phase 28 clearance review entry", server.includes("buildPhase28ClearanceReviewEntry") && server.includes("phase28ClearanceReviewEntry") && server.includes("phase28.clearance-review-entry.v1"));
assert("operations exposes phase 28 clearance review entry", operations.includes("buildPhase28ClearanceReviewEntry") && operations.includes("phase28ClearanceReviewEntry") && operations.includes("phase28.clearance-review-entry.v1"));
assert("frontend fallback exposes phase 28 clearance review entry", app.includes("buildLocalPhase28ClearanceReviewEntry") && app.includes("phase28ClearanceReviewEntry") && app.includes("phase28.clearance-review-entry.v1"));
assert("phase 28 sources phase 27 closure package", operations.includes("sourcePhase27") && operations.includes("phase27.closure-package.v1") && operations.includes("phase27ClosurePackage"));
assert("phase 28 uses read-only clearance review mode", operations.includes("release-blocker-clearance-review-no-runtime-execution") && operations.includes("pending-clearance-review") && operations.includes("clearance-review-open-no-mutation"));
assert("phase 28 carries open blockers into review queue", operations.includes("clearanceReviewQueue") && operations.includes("carried-forward-open") && operations.includes("requiredEvidence"));
assert("phase 28 blocks clearance, release, runtime, and persistence mutations", operations.includes("clear-blocker-from-review") && operations.includes("apply-clearance-review-as-clearance") && operations.includes("mark-releaseReady-true") && operations.includes("enable-runtime-execution") && operations.includes("enable-third-party-execution") && operations.includes("persist-clearance-review-as-release-approval"));
assert("phase 28 models evidence intake ledger", operations.includes("phase28.evidence-intake-ledger.v1") && operations.includes("readonly-evidence-intake-ledger-no-clearance") && operations.includes("pending-evidence-intake") && operations.includes("evidence-intake-open-no-mutation"));
assert("phase 28 evidence intake blocks clearance mutation", operations.includes("accept-evidence-as-clearance") && operations.includes("clear-blocker-from-evidence") && operations.includes("persist-evidence-intake-as-clearance"));
assert("phase 28 models reviewer disposition without clearance", operations.includes("phase28.reviewer-disposition-model.v1") && operations.includes("readonly-reviewer-disposition-model-no-clearance") && operations.includes("pending-reviewer-disposition") && operations.includes("reviewer-disposition-open-no-mutation"));
assert("phase 28 reviewer disposition blocks release and persistence mutation", operations.includes("apply-disposition-as-clearance") && operations.includes("clear-blocker-from-disposition") && operations.includes("mark-releaseReady-true") && operations.includes("persist-reviewer-disposition-as-clearance"));
assert("phase 28 models clearance criteria checklist without clearance", operations.includes("phase28.clearance-criteria-checklist.v1") && operations.includes("readonly-clearance-criteria-checklist-no-clearance") && operations.includes("pending-clearance-criteria") && operations.includes("clearance-criteria-open-no-mutation"));
assert("phase 28 criteria checklist blocks clearance and release mutation", operations.includes("mark-criteria-satisfied") && operations.includes("apply-criteria-as-clearance") && operations.includes("clear-blocker-from-criteria") && operations.includes("persist-clearance-criteria-as-clearance"));
assert("phase 28 models clearance decision preview without release", operations.includes("phase28.clearance-decision-preview.v1") && operations.includes("readonly-clearance-decision-preview-no-release") && operations.includes("hold-clearance") && operations.includes("decision-preview-open-no-mutation"));
assert("phase 28 decision preview blocks clearance and release approval", operations.includes("approve-release-from-preview") && operations.includes("apply-decision-preview-as-clearance") && operations.includes("persist-decision-preview-as-clearance") && operations.includes("apply-decision-preview-as-release-approval"));
assert("phase 28 models closure package without release approval", operations.includes("phase28.closure-package.v1") && operations.includes("readonly-phase28-closure-no-release-approval") && operations.includes("closed-with-open-blockers-carried-forward") && operations.includes("phase28Closed"));
assert("phase 28 closure package blocks release and runtime mutation", operations.includes("persist-phase28-closure-as-release-approval") && operations.includes("clear-blocker-from-phase28-closure") && operations.includes("auto-enter-release-from-closure") && operations.includes("phase29-release-governance-planning"));
assert("phase 28 export policy is registered", operations.includes("phase28-clearance-review-entry.json") && operations.includes("phase28-evidence-intake-ledger.json") && operations.includes("phase28-reviewer-disposition-model.json") && operations.includes("phase28-clearance-criteria-checklist.json") && operations.includes("phase28-clearance-decision-preview.json") && operations.includes("phase28-closure-package.json") && operations.includes("includeInOperationsExport: true"));
assert("frontend renders phase 28 panel", index.includes("phase28ClearanceReviewPanel") && app.includes("renderPhase28ClearanceReviewEntry"));
assert("api smoke covers phase 28 current version and exports", apiSmoke.includes("phase28ClearanceReviewEntry") && apiSmoke.includes("phase28.clearance-review-entry.v1") && apiSmoke.includes("phase28.evidence-intake-ledger.v1") && apiSmoke.includes("phase28.reviewer-disposition-model.v1") && apiSmoke.includes("phase28.clearance-criteria-checklist.v1") && apiSmoke.includes("phase28.clearance-decision-preview.v1") && apiSmoke.includes("phase28.closure-package.v1") && apiSmoke.includes("phase28-closure-package.json") && apiSmoke.includes("persist-clearance-review-as-release-approval") && apiSmoke.includes("persist-evidence-intake-as-clearance") && apiSmoke.includes("persist-reviewer-disposition-as-clearance") && apiSmoke.includes("persist-clearance-criteria-as-clearance") && apiSmoke.includes("persist-decision-preview-as-clearance") && apiSmoke.includes("persist-phase28-closure-as-release-approval"));
assert("docs document phase 28 calibration", readme.includes("1.8.5 / phase28-closure-package") && whitepaper.includes("1.8.5 / phase28-closure-package") && plan.includes("1.8.5 / phase28-closure-package"));

console.log("Phase 28 readiness checks passed.");

