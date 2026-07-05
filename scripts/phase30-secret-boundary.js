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
const secretBoundary = readText(workspaceRoot, "项目文档", "阶段30密钥边界计划.md");
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");

assert("phase 30 secret boundary does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 secret boundary does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 secret boundary check", packageJson.scripts["phase30:secret-boundary"] === "node scripts/phase30-secret-boundary.js");
assert("check pipeline includes phase 30 secret boundary", packageJson.scripts.check.includes("node scripts/phase30-secret-boundary.js"));
assert("README declares phase 30 secret boundary plan", readme.includes("Phase 30 secret boundary plan: active") && readme.includes("secret access and private memory access remain blocked"));
assert("project plan links to secret boundary plan", plan.includes("Phase 30 secret boundary plan: active") && plan.includes("阶段30密钥边界计划.md"));
assert("whitepaper explains secret boundary does not open access", whitepaper.includes("Phase 30 secret boundary plan: active") && whitepaper.includes("不开放 secret access"));
assert("transition plan links to secret boundary plan", transitionPlan.includes("阶段30密钥边界计划.md") && transitionPlan.includes("不开放任何 secret 或私人记忆读取"));
assert("planning baseline references secret boundary plan", phase30Plan.includes("2.0.2 / phase30-secret-boundary-plan") && phase30Plan.includes("阶段30密钥边界计划.md"));
assert("entry baseline marks secret boundary ready as dry-run only", entryBaseline.includes("secret-boundary-ready | pass-dry-run") && entryBaseline.includes("仍不开放 secret 或 SQLite 私人记忆读取"));
assert("sandbox harness links to secret boundary plan", sandboxHarness.includes("阶段30密钥边界计划.md") && sandboxHarness.includes("no-secret-access"));
assert("secret boundary declares 2.0.2 identity", secretBoundary.includes("2.0.2 / phase30-secret-boundary-plan") && secretBoundary.includes("Phase 30 secret boundary plan: active"));
assert("secret boundary keeps access blocked", secretBoundary.includes("Secret access remains blocked."));
assert("secret boundary preserves disabled state", secretBoundary.includes("releaseReady=false") && secretBoundary.includes("phase29ExitReady=false") && secretBoundary.includes("phase30EntryReady=false") && secretBoundary.includes("runtimeExecution=false") && secretBoundary.includes("thirdPartyExecution=false"));
assert("secret boundary blocks secret access", secretBoundary.includes("No secret access in phase30-secret-boundary-plan."));
assert("secret boundary classifies sensitive boundaries", secretBoundary.includes("plugin-secret-boundary") && secretBoundary.includes("app-secret-boundary") && secretBoundary.includes("sqlite-memory-boundary") && secretBoundary.includes("redacted-export-boundary") && secretBoundary.includes("audit-metadata-boundary") && secretBoundary.includes("runtime-state-boundary"));
assert("secret boundary defines deny rules", secretBoundary.includes("deny-env-secret-read") && secretBoundary.includes("deny-plugin-secret-read") && secretBoundary.includes("deny-ai-api-key-read") && secretBoundary.includes("deny-sqlite-raw-memory-read") && secretBoundary.includes("deny-runtime-state-write"));
assert("secret boundary defines allowed dry-run fields", secretBoundary.includes("fixtureId") && secretBoundary.includes("boundaryId") && secretBoundary.includes("redactionApplied") && secretBoundary.includes("runtimeExecution=false"));
assert("secret boundary excludes sensitive evidence content", secretBoundary.includes("原始记忆正文") && secretBoundary.includes("AI API key") && secretBoundary.includes("签名私钥或安装密钥"));
assert("secret boundary defines fixture boundary cases", secretBoundary.includes("deny-env-secret-read-fixture") && secretBoundary.includes("deny-sqlite-raw-memory-read-fixture") && secretBoundary.includes("allow-audit-id-dry-run-fixture") && secretBoundary.includes("allow-redacted-export-fixture"));
assert("secret boundary defines manual review requirements", secretBoundary.includes("人工复核要求") && secretBoundary.includes("blocked 结果标记为 pass") && secretBoundary.includes("release approval"));
assert("secret boundary links follow-up versions", secretBoundary.includes("2.0.3 / phase30-audit-persistence-dry-run") && secretBoundary.includes("2.0.4 / phase30-runtime-go-no-go-board"));
assert("secret boundary defines completion standard", secretBoundary.includes("phase30:secret-boundary") && secretBoundary.includes("phase30:sandbox-acceptance") && secretBoundary.includes("npm.cmd run check"));

console.log("Phase 30 secret boundary checks passed.");
