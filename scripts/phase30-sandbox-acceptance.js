const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");

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
const transitionPlan = readText(workspaceRoot, "项目文档", "阶段29收口与阶段30规划.md");
const phase30Plan = readText(workspaceRoot, "项目文档", "阶段30规划基线.md");
const entryBaseline = readText(workspaceRoot, "项目文档", "阶段30入口基线.md");
const sandboxHarness = readText(workspaceRoot, "项目文档", "阶段30运行时沙箱验收框架.md");
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");

assert("phase 30 sandbox acceptance does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 sandbox acceptance does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 sandbox acceptance check", packageJson.scripts["phase30:sandbox-acceptance"] === "node scripts/phase30-sandbox-acceptance.js");
assert("check pipeline includes phase 30 sandbox acceptance", packageJson.scripts.check.includes("node scripts/phase30-sandbox-acceptance.js"));
assert("README declares phase 30 sandbox acceptance harness", readme.includes("Phase 30 runtime sandbox acceptance harness: active") && readme.includes("real plugin execution and runtime sandbox execution remain inactive"));
assert("project plan links to sandbox acceptance harness", plan.includes("Phase 30 runtime sandbox acceptance harness: active") && plan.includes("阶段30运行时沙箱验收框架.md"));
assert("whitepaper explains sandbox harness is not runtime enablement", whitepaper.includes("Phase 30 runtime sandbox acceptance harness: active") && whitepaper.includes("不执行真实第三方插件"));
assert("transition plan links to sandbox acceptance harness", transitionPlan.includes("阶段30运行时沙箱验收框架.md") && transitionPlan.includes("不启用运行时"));
assert("planning baseline references sandbox acceptance harness", phase30Plan.includes("2.0.1 / phase30-runtime-sandbox-acceptance-harness") && phase30Plan.includes("阶段30运行时沙箱验收框架.md"));
assert("entry baseline marks sandbox plan ready as dry-run only", entryBaseline.includes("sandbox-plan-ready | pass-dry-run") && entryBaseline.includes("不执行真实插件"));
assert("sandbox harness declares 2.0.1 identity", sandboxHarness.includes("2.0.1 / phase30-runtime-sandbox-acceptance-harness") && sandboxHarness.includes("Phase 30 runtime sandbox acceptance harness: active"));
assert("sandbox harness keeps execution inactive", sandboxHarness.includes("Runtime sandbox execution remains inactive."));
assert("sandbox harness preserves disabled state", sandboxHarness.includes("releaseReady=false") && sandboxHarness.includes("phase29ExitReady=false") && sandboxHarness.includes("phase30EntryReady=false") && sandboxHarness.includes("runtimeExecution=false") && sandboxHarness.includes("thirdPartyExecution=false"));
assert("sandbox harness blocks real plugin execution", sandboxHarness.includes("No real plugin execution in phase30-runtime-sandbox-acceptance-harness."));
assert("sandbox harness lists fixture scenarios", sandboxHarness.includes("allow-basic-manifest-fixture") && sandboxHarness.includes("deny-network-access-fixture") && sandboxHarness.includes("deny-secret-read-fixture") && sandboxHarness.includes("deny-sqlite-memory-read-fixture") && sandboxHarness.includes("timeout-runaway-fixture") && sandboxHarness.includes("invalid-output-fixture") && sandboxHarness.includes("crash-exit-fixture"));
assert("sandbox harness defines isolation boundaries", sandboxHarness.includes("no-network-access") && sandboxHarness.includes("no-secret-access") && sandboxHarness.includes("no-sqlite-memory-access") && sandboxHarness.includes("no-third-party-code-execution") && sandboxHarness.includes("quarantine-only-output"));
assert("sandbox harness defines dry-run evidence format", sandboxHarness.includes("fixtureId") && sandboxHarness.includes("boundaryChecks") && sandboxHarness.includes("manualReviewRequired"));
assert("sandbox harness keeps evidence from changing readiness", sandboxHarness.includes("runtimeExecution=false") && sandboxHarness.includes("thirdPartyExecution=false") && sandboxHarness.includes("phase30EntryReady=false"));
assert("sandbox harness defines acceptance criteria", sandboxHarness.includes("验收设计完整") && sandboxHarness.includes("检查脚本只验证文档和设计完整性，不执行任何插件代码"));
assert("sandbox harness links follow-up versions", sandboxHarness.includes("2.0.2 / phase30-secret-boundary-plan") && sandboxHarness.includes("2.0.3 / phase30-audit-persistence-dry-run") && sandboxHarness.includes("2.0.4 / phase30-runtime-go-no-go-board"));
assert("sandbox harness defines completion standard", sandboxHarness.includes("phase30:sandbox-acceptance") && sandboxHarness.includes("phase30:entry-baseline") && sandboxHarness.includes("npm.cmd run check"));

console.log("Phase 30 runtime sandbox acceptance checks passed.");
