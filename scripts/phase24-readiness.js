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
    throw new Error(`Phase 24 readiness failed: ${name}`);
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

assert("server reports phase 24 closure package under phase 29", server.includes("const PHASE = 29") && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package registers phase 24 readiness", packageJson.includes('"version": "1.9.48"') && packageJson.includes("phase24-readiness") && packageJson.includes("phase24:closure-package"));
assert("server exposes phase 24 closure package", server.includes("buildPhase24RuntimeSandboxUxEntry") && server.includes("phase24RuntimeSandboxUxEntry") && server.includes("phase24.closure-package.v1"));
assert("operations exposes phase 24 closure package", operations.includes("buildPhase24RuntimeSandboxUxEntry") && operations.includes("phase24RuntimeSandboxUxEntry") && operations.includes("phase24.closure-package.v1"));
assert("frontend fallback exposes phase 24 closure package", app.includes("buildLocalPhase24RuntimeSandboxUxEntry") && app.includes("phase24RuntimeSandboxUxEntry") && app.includes("phase24.closure-package.v1"));
assert("phase 23 closure handoff remains the source", operations.includes("phase23ClosureHandoffPackage") && operations.includes("phase23.closure-handoff-package.v1") && operations.includes("sourceHandoff: \"phase23ReleaseReadinessReviewUi.phase23ClosureHandoffPackage\""));
assert("phase 24 entry remains read-only and release blocked", operations.includes("readonly-ux-implementation-no-code-execution") && operations.includes("runtimeExecution: false") && operations.includes("thirdPartyExecution: false") && operations.includes("releaseReady: false"));
assert("phase 24 entry declares scoped UX work", operations.includes("runtime-preflight-workbench") && operations.includes("permission-decision-review-flow") && operations.includes("quarantine-review-queue") && operations.includes("runtime-evidence-export-pack") && operations.includes("release-clearance-preview"));
assert("phase 24 entry blocks execution and release actions", operations.includes("execute-third-party-plugin") && operations.includes("enable-runtime-execution") && operations.includes("enable-third-party-execution") && operations.includes("mark-release-ready"));
assert("phase 24 preflight workbench is modeled", operations.includes("runtimePreflightWorkbench") && operations.includes("phase24.runtime-preflight-workbench.v1") && operations.includes("run-preflight-execution"));
assert("phase 24 permission decision review is modeled", operations.includes("permissionDecisionReviewFlow") && operations.includes("phase24.permission-decision-review-flow.v1") && operations.includes("grant-runtime-permission") && operations.includes("unknown-host-api"));
assert("phase 24 quarantine review queue is modeled", operations.includes("quarantineReviewQueue") && operations.includes("phase24.quarantine-review-queue.v1") && operations.includes("apply-quarantined-result"));
assert("phase 24 runtime evidence export pack is modeled", operations.includes("runtimeEvidenceExportPack") && operations.includes("phase24.runtime-evidence-export-pack.v1") && operations.includes("phase24-runtime-evidence-export-pack.json") && operations.includes("mutate-release-state-from-export"));
assert("phase 24 release clearance preview is modeled", operations.includes("releaseClearancePreview") && operations.includes("phase24.release-clearance-preview.v1") && operations.includes("derived-readonly-no-release-mutation"));
assert("phase 24 closure package is modeled", operations.includes("phase24ClosurePackage") && operations.includes("phase24.closure-package.v1") && operations.includes("completedVersionRange: \"1.4.1-1.4.6\"") && operations.includes("phase24-closure-package"));
assert("phase 24 entry export is guarded", operations.includes("phase24-closure-package.json") && operations.includes("phase24-entry-without-phase23-handoff") && operations.includes("releaseReady-true-before-clearance"));
assert("api smoke preserves phase 24 closure and covers phase 25 surface", apiSmoke.includes("phase24.closure-package.v1") && apiSmoke.includes("phase24-closure-package.json") && apiSmoke.includes("phase25.runtime-sandbox-ui-surface.v1") && apiSmoke.includes("operations API exposes phase 25 runtime sandbox UI surface"));
assert("docs preserve phase 24 closure under phase 25 calibration", readme.includes("phase24-closure-package") && whitepaper.includes("phase24-closure-package") && plan.includes("phase24-closure-package") && readme.includes("phase25-runtime-sandbox-ui-surface") && whitepaper.includes("phase25-runtime-sandbox-ui-surface") && plan.includes("phase25-runtime-sandbox-ui-surface"));

console.log("Phase 24 readiness checks passed.");

