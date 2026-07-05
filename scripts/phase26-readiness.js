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
    throw new Error(`Phase 26 readiness failed: ${name}`);
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

assert("server preserves phase 26 validation entry under phase 29", server.includes("const PHASE = 29") && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package registers phase 26 readiness", packageJson.includes('"version": "1.9.48"') && packageJson.includes("phase26-readiness") && packageJson.includes("phase26:validation-entry") && packageJson.includes("phase26:release-gate-simulation") && packageJson.includes("phase26:blocker-clearance-simulation") && packageJson.includes("phase26:runtime-validation-report") && packageJson.includes("phase26:handoff-criteria") && packageJson.includes("phase26:closure-package"));
assert("server exposes phase 26 runtime validation entry", server.includes("buildPhase26RuntimeValidationEntry") && server.includes("phase26RuntimeValidationEntry") && server.includes("phase26.runtime-validation-entry.v1"));
assert("operations exposes phase 26 runtime validation entry", operations.includes("buildPhase26RuntimeValidationEntry") && operations.includes("phase26RuntimeValidationEntry") && operations.includes("phase26.runtime-validation-entry.v1"));
assert("frontend fallback exposes phase 26 runtime validation entry", app.includes("buildLocalPhase26RuntimeValidationEntry") && app.includes("phase26RuntimeValidationEntry") && app.includes("phase26.runtime-validation-entry.v1"));
assert("phase 26 source remains phase 25 validation package", operations.includes("sourcePhase25") && operations.includes("phase25.review-package-validation.v1") && operations.includes("phase25-review-export-package.json"));
assert("phase 26 declares simulation scopes", operations.includes("release-gate-simulation") && operations.includes("runtime-boundary-validation") && operations.includes("blocker-clearance-simulation") && operations.includes("runtime-validation-report"));
assert("phase 26 blocks runtime mutation", operations.includes("release-gate-simulation-entry-no-runtime-execution") && operations.includes("enable-runtime-execution") && operations.includes("execute-third-party-plugin") && operations.includes("set-releaseReady-true") && operations.includes("persistedMutations: 0"));
assert("phase 26 models release gate simulation", operations.includes("phase26.release-gate-simulation.v1") && operations.includes("readonly-release-gate-simulation-no-runtime-execution") && operations.includes("phase26-release-gate-simulation.json") && operations.includes("release-ready-remains-blocked") && operations.includes("persist-simulated-decision"));
assert("phase 26 models blocker clearance simulation", operations.includes("phase26.blocker-clearance-simulation.v1") && operations.includes("readonly-blocker-clearance-simulation-no-release-mutation") && operations.includes("phase26-blocker-clearance-simulation.json") && operations.includes("blockers-not-cleared") && operations.includes("persist-simulated-clearance"));
assert("phase 26 models runtime validation report", operations.includes("phase26.runtime-validation-report.v1") && operations.includes("readonly-runtime-validation-report-no-runtime-execution") && operations.includes("phase26-runtime-validation-report.json") && operations.includes("report-blocked-for-runtime-release") && operations.includes("persist-report-as-runtime-result"));
assert("phase 26 models handoff criteria", operations.includes("phase26.handoff-criteria.v1") && operations.includes("readonly-handoff-criteria-no-runtime-or-release-mutation") && operations.includes("phase26-handoff-criteria.json") && operations.includes("handoff-ready-with-release-blockers") && operations.includes("persist-handoff-as-release-approval"));
assert("phase 26 models closure package", operations.includes("phase26.closure-package.v1") && operations.includes("readonly-closure-package-no-runtime-or-release-mutation") && operations.includes("phase26-closure-package.json") && operations.includes("phase26-closed-with-release-blockers") && operations.includes("persist-closure-as-runtime-result"));
assert("frontend renders phase 26 validation entry", index.includes("phase26ValidationPanel") && app.includes("renderPhase26RuntimeValidationEntry") && app.includes("Phase 26 runtime validation entry check"));
assert("api smoke covers phase 26 current version and exports", apiSmoke.includes("phase26RuntimeValidationEntry") && apiSmoke.includes("phase26.runtime-validation-entry.v1") && apiSmoke.includes("phase26.release-gate-simulation.v1") && apiSmoke.includes("phase26.blocker-clearance-simulation.v1") && apiSmoke.includes("phase26.runtime-validation-report.v1") && apiSmoke.includes("phase26.handoff-criteria.v1") && apiSmoke.includes("phase26.closure-package.v1") && apiSmoke.includes("phase26-closure-package.json"));
assert("docs document phase 26 calibration", readme.includes("phase26-closure-package") && whitepaper.includes("phase26-closure-package") && plan.includes("phase26-closure-package"));

console.log("Phase 26 readiness checks passed.");

