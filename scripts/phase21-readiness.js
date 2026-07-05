const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 21 readiness failed: ${name}`);
  }
  console.log(`ok - ${name}`);
}

const app = read("\u9879\u76ee\u5de5\u7a0b/app.js");
const server = read("\u9879\u76ee\u5de5\u7a0b/server.js");
const operations = read("\u9879\u76ee\u5de5\u7a0b/src/services/operations.js");
const packageJson = read("\u9879\u76ee\u5de5\u7a0b/package.json");
const apiSmoke = read("\u9879\u76ee\u5de5\u7a0b/scripts/api-smoke.js");
const readme = read("\u9879\u76ee\u5de5\u7a0b/README.md");
const whitepaper = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");
const plan = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");

assert("server preserves phase 21 under phase 29", server.includes("const PHASE = 29") && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package registers phase 21 readiness", packageJson.includes('"version": "1.9.48"') && packageJson.includes("phase21-readiness") && packageJson.includes("phase21:runtime-sandbox"));
assert("server exports phase 21 runtime sandbox plan", server.includes("buildPhase21RuntimeSandboxPlan") && server.includes("phase21RuntimeSandboxPlan") && server.includes("phase21.runtime.sandbox-foundation.v1"));
assert("operations exports phase 21 runtime sandbox plan", operations.includes("buildPhase21RuntimeSandboxPlan") && operations.includes("phase21RuntimeSandboxPlan") && operations.includes("phase21.plugin.runtime-audit.v1"));
assert("frontend has local phase 21 fallback", app.includes("buildLocalPhase21RuntimeSandboxPlan") && app.includes("phase21RuntimeSandboxPlan") && app.includes("phase21-runtime-sandbox-foundation"));
assert("phase 20 platform plan remains preserved", server.includes("buildPhase20PlatformPlan") && operations.includes("buildPhase20PlatformPlan") && app.includes("buildLocalPhase20PlatformPlan"));
assert("third-party execution remains disabled", server.includes("thirdPartyExecution: false") && operations.includes("thirdPartyExecution: false") && app.includes("thirdPartyExecution: false"));
assert("runtime execution remains disabled", server.includes("runtimeExecution: false") && operations.includes("runtimeExecution: false") && app.includes("runtimeExecution: false"));
assert("host API boundary blocks direct access", operations.includes("directDatabaseAccess: false") && operations.includes("directFilesystemAccess: false") && operations.includes("networkAccess: false") && operations.includes("secretAccess: false"));
assert("permission runtime policy is modeled", server.includes("permissionRuntimePolicy") && operations.includes("phase21.permission.runtime-enforcement.v1") && app.includes("permissionRuntimePolicy"));
assert("permission runtime policy denies by default", operations.includes('defaultDecision: "deny"') && operations.includes("unknownHostApiDecision") && operations.includes("permission-not-granted"));
assert("permission runtime policy maps Host APIs", operations.includes("hostApiPermissions") && operations.includes("read-redacted-input") && operations.includes("emit-audit-event") && operations.includes("plugin.fixture.read"));
assert("permission runtime policy records decisions", operations.includes("samplePermissionDecisions") && operations.includes("permission-runtime-decision") && operations.includes("lockfile-entry-blocked"));
assert("sandbox runner uses kill switch", operations.includes("phase21-plugin-sandbox-runner") && operations.includes("killSwitch: true") && operations.includes("kill-switch-disabled"));
assert("runtime audit schema is defined", operations.includes("runtime-requested") && operations.includes("runtime-blocked") && operations.includes("runtime-output-rejected") && operations.includes("blockedReason"));
assert("runtime audit replay is modeled", server.includes("runtimeAuditReplay") && operations.includes("phase21.runtime-audit-replay.v1") && app.includes("runtimeAuditReplay"));
assert("runtime audit replay stays audit-only", operations.includes('replayMode: "audit-only-no-code-execution"') && operations.includes("verify-runtime-audit-replay") && operations.includes("blocked-reason-mismatch"));
assert("output validation gate is modeled", server.includes("outputValidationGate") && operations.includes("phase21.output-validation-gate.v1") && app.includes("outputValidationGate"));
assert("output validation gate rejects unsafe output", operations.includes('validationMode: "post-runtime-contract-model-only"') && operations.includes("verify-runtime-output-validation") && operations.includes("sensitive-field-leak") && operations.includes("runtime-disabled-and-output-untrusted"));
assert("importer runtime fixtures are modeled", server.includes("importerRuntimeFixtures") && operations.includes("phase21.importer-runtime-fixtures.v1") && app.includes("importerRuntimeFixtures"));
assert("importer runtime fixtures stay deterministic", operations.includes('fixtureMode: "deterministic-fixture-only-no-code-execution"') && operations.includes("markdown-diary-importer-fixture") && operations.includes("verify-importer-runtime-fixtures") && operations.includes("fixture-input-unredacted"));
assert("runtime result quarantine is modeled", server.includes("runtimeResultQuarantine") && operations.includes("phase21.runtime-result-quarantine.v1") && app.includes("runtimeResultQuarantine"));
assert("runtime result quarantine blocks untrusted results", operations.includes('quarantineMode: "model-only-block-untrusted-results"') && operations.includes("verify-runtime-result-quarantine") && operations.includes("release-ready-while-quarantined") && operations.includes("quarantine-markdown-fixture-result"));
assert("runtime preflight depends on phase 20 release gates", operations.includes("phase20PlatformPlan.pluginReleaseChecklistGate") && operations.includes("verify-release-checklist-gate") && operations.includes("verify-signed-manifest") && operations.includes("verify-host-api-permission") && operations.includes("record-runtime-audit"));
assert("smoke covers phase 21 current version", apiSmoke.includes("version API reports phase 29") && apiSmoke.includes("operations API reports phase 29") && apiSmoke.includes("phase21.runtime.sandbox-foundation.v1"));
assert("smoke covers phase 21 exports", apiSmoke.includes("version API exposes phase 21 runtime sandbox plan") && apiSmoke.includes("operations export includes phase 21 runtime sandbox plan") && apiSmoke.includes("export includes phase 21 runtime sandbox plan"));
assert("docs document phase 21 calibration", readme.includes("phase23-release-readiness-review-ui") && whitepaper.includes("phase23-release-readiness-review-ui") && plan.includes("phase23-release-readiness-review-ui"));

console.log("Phase 21 readiness checks passed.");

