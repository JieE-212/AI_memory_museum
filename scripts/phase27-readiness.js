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
    throw new Error(`Phase 27 readiness failed: ${name}`);
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

assert("server preserves phase 27 closure package under phase 29", server.includes("const PHASE = 29") && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package registers phase 27 readiness", packageJson.includes('"version": "1.9.48"') && packageJson.includes("phase27-readiness") && packageJson.includes("phase27:entry-package") && packageJson.includes("phase27:carried-blocker-inventory") && packageJson.includes("phase27:human-review-signoff") && packageJson.includes("phase27:evidence-gap-matrix") && packageJson.includes("phase27:blocker-resolution-plan") && packageJson.includes("phase27:closure-package"));
assert("server exposes phase 27 release blocker governance entry", server.includes("buildPhase27ReleaseBlockerGovernanceEntry") && server.includes("phase27ReleaseBlockerGovernanceEntry") && server.includes("phase27.release-blocker-governance-entry.v1"));
assert("operations exposes phase 27 release blocker governance entry", operations.includes("buildPhase27ReleaseBlockerGovernanceEntry") && operations.includes("phase27ReleaseBlockerGovernanceEntry") && operations.includes("phase27.release-blocker-governance-entry.v1"));
assert("frontend fallback exposes phase 27 release blocker governance entry", app.includes("buildLocalPhase27ReleaseBlockerGovernanceEntry") && app.includes("phase27ReleaseBlockerGovernanceEntry") && app.includes("phase27.release-blocker-governance-entry.v1"));
assert("phase 27 source is phase 26 closure package", operations.includes("sourcePhase26") && operations.includes("phase26.closure-package.v1") && operations.includes("phase26-closure-package.json"));
assert("phase 27 entry package is read only", operations.includes("phase27.entry-package.v1") && operations.includes("readonly-release-blocker-governance-entry") && operations.includes("phase27-entry-package.json"));
assert("phase 27 carries release blockers", operations.includes("carriedBlockerInventory") && operations.includes("release-ready-remains-blocked") && operations.includes("clear-carried-forward-blocker"));
assert("phase 27 models carried blocker inventory package", operations.includes("phase27.carried-blocker-inventory.v1") && operations.includes("readonly-carried-blocker-inventory-no-clearance") && operations.includes("phase27-carried-blocker-inventory.json") && operations.includes("persist-inventory-as-clearance"));
assert("phase 27 models human review signoff package", operations.includes("phase27.human-review-signoff.v1") && operations.includes("readonly-human-review-signoff-no-release-approval") && operations.includes("phase27-human-review-signoff.json") && operations.includes("persist-signoff-as-release-approval"));
assert("phase 27 models evidence gap matrix package", operations.includes("phase27.evidence-gap-matrix.v1") && operations.includes("readonly-evidence-gap-matrix-no-clearance") && operations.includes("phase27-evidence-gap-matrix.json") && operations.includes("persist-gap-resolution-as-clearance"));
assert("phase 27 models blocker resolution plan package", operations.includes("phase27.blocker-resolution-plan.v1") && operations.includes("readonly-blocker-resolution-plan-no-clearance") && operations.includes("phase27-blocker-resolution-plan.json") && operations.includes("persist-resolution-plan-as-clearance"));
assert("phase 27 models closure package", operations.includes("phase27.closure-package.v1") && operations.includes("readonly-phase27-closure-no-release-approval") && operations.includes("phase27-closure-package.json") && operations.includes("persist-closure-as-release-clearance"));
assert("phase 27 blocks runtime and release mutation", operations.includes("enable-runtime-execution") && operations.includes("enable-third-party-execution") && operations.includes("mark-releaseReady-true") && operations.includes("persist-governance-entry-as-runtime-result") && operations.includes("persist-gap-resolution-as-clearance") && operations.includes("persist-resolution-plan-as-clearance") && operations.includes("persist-closure-as-release-clearance"));
assert("phase 27 models governance scopes", operations.includes("human-review-signoff") && operations.includes("evidence-gap-matrix") && operations.includes("blocker-resolution-plan") && operations.includes("phase27-closure-package"));
assert("frontend renders phase 27 governance entry", index.includes("phase27GovernancePanel") && app.includes("renderPhase27ReleaseBlockerGovernanceEntry"));
assert("api smoke covers phase 27 current version and exports", apiSmoke.includes("phase27ReleaseBlockerGovernanceEntry") && apiSmoke.includes("phase27.release-blocker-governance-entry.v1") && apiSmoke.includes("phase27.carried-blocker-inventory.v1") && apiSmoke.includes("phase27.human-review-signoff.v1") && apiSmoke.includes("phase27.evidence-gap-matrix.v1") && apiSmoke.includes("phase27.blocker-resolution-plan.v1") && apiSmoke.includes("phase27.closure-package.v1") && apiSmoke.includes("phase27-closure-package.json") && apiSmoke.includes("phase27-release-blocker-governance-entry.json"));
assert("docs document phase 27 closure baseline and phase 28 calibration", readme.includes("phase27-closure-package") && readme.includes("phase28-closure-package") && whitepaper.includes("phase27-closure-package") && whitepaper.includes("phase28-closure-package") && plan.includes("phase27-closure-package") && plan.includes("phase28-closure-package"));

console.log("Phase 27 readiness checks passed.");

