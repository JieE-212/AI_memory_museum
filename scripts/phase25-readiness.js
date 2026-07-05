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
    throw new Error(`Phase 25 readiness failed: ${name}`);
  }
  console.log(`ok - ${name}`);
}

const app = readProject("app.js");
const server = readProject("server.js");
const operations = readProject("src/services/operations.js");
const packageJson = readProject("package.json");
const apiSmoke = readProject("scripts/api-smoke.js");
const index = readProject("index.html");
const styles = readProject("styles.css");
const readme = readProject("README.md");
const whitepaper = readWorkspace("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");
const plan = readWorkspace("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");

assert("server preserves phase 25 runtime sandbox UI surface under phase 29", server.includes("const PHASE = 29") && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package registers phase 25 readiness", packageJson.includes('"version": "1.9.48"') && packageJson.includes("phase25-readiness") && packageJson.includes("phase25:runtime-sandbox-ui-surface") && packageJson.includes("phase25:surface-state-model") && packageJson.includes("phase25:panel-evidence-bindings") && packageJson.includes("phase25:review-action-model") && packageJson.includes("phase25:review-audit-preview") && packageJson.includes("phase25:review-export-package") && packageJson.includes("phase25:review-package-validation"));
assert("server exposes phase 25 runtime sandbox UI surface", server.includes("buildPhase25RuntimeSandboxUiSurface") && server.includes("phase25RuntimeSandboxUiSurface") && server.includes("phase25.runtime-sandbox-ui-surface.v1"));
assert("operations exposes phase 25 runtime sandbox UI surface", operations.includes("buildPhase25RuntimeSandboxUiSurface") && operations.includes("phase25RuntimeSandboxUiSurface") && operations.includes("phase25.runtime-sandbox-ui-surface.v1"));
assert("frontend fallback exposes phase 25 runtime sandbox UI surface", app.includes("buildLocalPhase25RuntimeSandboxUiSurface") && app.includes("phase25RuntimeSandboxUiSurface") && app.includes("phase25.runtime-sandbox-ui-surface.v1"));
assert("phase 25 source is phase 24 closure package", operations.includes("sourceClosure") && operations.includes("phase24.phase24ClosurePackage") && operations.includes("phase24Complete"));
assert("phase 25 renders a UI surface panel", index.includes("phase25SurfacePanel") && app.includes("renderPhase25RuntimeSandboxUiSurface") && styles.includes("phase25-tab-strip"));
assert("phase 25 declares five UI panels", operations.includes("runtime-preflight-workbench") && operations.includes("permission-decision-review") && operations.includes("quarantine-review-queue") && operations.includes("runtime-evidence-export-pack") && operations.includes("release-clearance-preview"));
assert("phase 25 declares a read-only surface state model", operations.includes("phase25.surface-state-model.v1") && operations.includes("readonly-browser-state-no-runtime-mutation") && operations.includes("filterPresets") && operations.includes("blockedStateMutations"));
assert("phase 25 binds panels to source evidence", operations.includes("panelEvidenceBindings") && operations.includes("sourceSchemaVersion") && operations.includes("sourceCount") && operations.includes("integrityChecks") && operations.includes("redacted-export-only"));
assert("phase 25 models read-only review actions", operations.includes("phase25.review-action-model.v1") && operations.includes("readonly-review-preview-no-release-mutation") && operations.includes("globalReviewActions") && operations.includes("blockedMutationPolicy") && operations.includes("persistedMutations: 0"));
assert("phase 25 models read-only review audit preview", operations.includes("phase25.review-audit-preview.v1") && operations.includes("phase25-review-audit-preview.json") && operations.includes("blockedMutationEvents") && operations.includes("readonly-action-audit-preview-no-persistence") && operations.includes("writesToReleaseState: false"));
assert("phase 25 models read-only review export package", operations.includes("phase25.review-export-package.v1") && operations.includes("phase25-review-export-package.json") && operations.includes("includedArtifacts") && operations.includes("integrityManifest") && operations.includes("blockedExportMutations") && operations.includes("requiresRuntimeExecutionFalse: true"));
assert("phase 25 validates read-only review package", operations.includes("phase25.review-package-validation.v1") && operations.includes("phase25-review-package-validation.json") && operations.includes("artifactChecks") && operations.includes("guardrailChecks") && operations.includes("blockedValidationMutations") && operations.includes("readonly-package-validation-no-runtime-execution"));
assert("frontend renders phase 25 surface state", app.includes("State model") && app.includes("Filter presets") && app.includes("Blocked state mutations") && app.includes("Evidence bindings") && app.includes("Review actions") && app.includes("Audit preview") && app.includes("Export package") && app.includes("Package validation") && app.includes("Validation blocked mutations"));
assert("phase 25 remains read-only and export-only", operations.includes("readonly-review-export-no-code-execution") && operations.includes("run-preflight-execution") && operations.includes("grant-runtime-permission") && operations.includes("apply-quarantined-result") && operations.includes("mark-release-ready"));
assert("phase 25 export is guarded", operations.includes("phase25-runtime-sandbox-ui-surface.json") && operations.includes("ui-state-and-redacted-evidence-only") && operations.includes("includeInOperationsExport: true"));
assert("api smoke covers phase 29 current version and phase 25 surface", apiSmoke.includes("version API reports phase 29") && apiSmoke.includes("phase25.runtime-sandbox-ui-surface.v1") && apiSmoke.includes("operations API exposes phase 25 runtime sandbox UI surface"));
assert("docs document phase 25 calibration", readme.includes("phase25-review-package-validation") && whitepaper.includes("phase25-review-package-validation") && plan.includes("phase25-review-package-validation"));

console.log("Phase 25 readiness checks passed.");

