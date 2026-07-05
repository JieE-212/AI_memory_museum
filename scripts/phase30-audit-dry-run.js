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
const auditDryRun = readText(workspaceRoot, "项目文档", "阶段30审计持久化演练.md");
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");

assert("phase 30 audit dry-run does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 audit dry-run does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 audit dry-run check", packageJson.scripts["phase30:audit-dry-run"] === "node scripts/phase30-audit-dry-run.js");
assert("check pipeline includes phase 30 audit dry-run", packageJson.scripts.check.includes("node scripts/phase30-audit-dry-run.js"));
assert("README declares phase 30 audit dry-run", readme.includes("Phase 30 audit persistence dry-run: active") && readme.includes("runtime state persistence remains disabled"));
assert("project plan links to audit dry-run", plan.includes("Phase 30 audit persistence dry-run: active") && plan.includes("阶段30审计持久化演练.md"));
assert("whitepaper explains audit dry-run is not release approval", whitepaper.includes("Phase 30 audit persistence dry-run: active") && whitepaper.includes("不代表发布批准"));
assert("transition plan links to audit dry-run", transitionPlan.includes("阶段30审计持久化演练.md") && transitionPlan.includes("不写入真实运行时状态"));
assert("planning baseline references audit dry-run", phase30Plan.includes("2.0.3 / phase30-audit-persistence-dry-run") && phase30Plan.includes("阶段30审计持久化演练.md"));
assert("entry baseline marks audit dry-run ready", entryBaseline.includes("audit-dry-run-ready | pass-dry-run") && entryBaseline.includes("不写运行时状态"));
assert("sandbox harness links to audit dry-run", sandboxHarness.includes("阶段30审计持久化演练.md") && sandboxHarness.includes("fixture evidence"));
assert("secret boundary links to audit dry-run", secretBoundary.includes("阶段30审计持久化演练.md") && secretBoundary.includes("dry-run evidence"));
assert("audit dry-run declares 2.0.3 identity", auditDryRun.includes("2.0.3 / phase30-audit-persistence-dry-run") && auditDryRun.includes("Phase 30 audit persistence dry-run: active"));
assert("audit dry-run remains dry-run only", auditDryRun.includes("Audit persistence remains dry-run only."));
assert("audit dry-run preserves disabled state", auditDryRun.includes("releaseReady=false") && auditDryRun.includes("phase29ExitReady=false") && auditDryRun.includes("phase30EntryReady=false") && auditDryRun.includes("runtimeExecution=false") && auditDryRun.includes("thirdPartyExecution=false"));
assert("audit dry-run blocks runtime state persistence", auditDryRun.includes("No runtime state persistence in phase30-audit-persistence-dry-run."));
assert("audit dry-run defines input sources", auditDryRun.includes("阶段30运行时沙箱验收框架.md") && auditDryRun.includes("阶段30密钥边界计划.md") && auditDryRun.includes("Phase 29 runtime audit replay"));
assert("audit dry-run defines event schema", auditDryRun.includes("auditEventId") && auditDryRun.includes("schemaVersion") && auditDryRun.includes("correlationId") && auditDryRun.includes("rollbackHint"));
assert("audit dry-run excludes sensitive payloads", auditDryRun.includes("secret value") && auditDryRun.includes("原始记忆正文") && auditDryRun.includes("SQLite 数据行"));
assert("audit dry-run defines ledger fields", auditDryRun.includes("Dry-run Ledger") && auditDryRun.includes("persistedRuntimeMutation") && auditDryRun.includes("always false"));
assert("audit dry-run defines correlation rules", auditDryRun.includes("每个 fixture 至少有一个 `correlationId`") && auditDryRun.includes("每个 blocked 事件必须关联 `blockedReason`"));
assert("audit dry-run defines export summary", auditDryRun.includes("runtimeMutationCount=0") && auditDryRun.includes("secretValueCount=0") && auditDryRun.includes("privateMemoryPayloadCount=0"));
assert("audit dry-run defines forbidden actions", auditDryRun.includes("persist-runtime-state") && auditDryRun.includes("mark-releaseReady-true") && auditDryRun.includes("use-audit-export-as-release-approval"));
assert("audit dry-run links go/no-go board", auditDryRun.includes("2.0.4 / phase30-runtime-go-no-go-board"));
assert("audit dry-run defines completion standard", auditDryRun.includes("phase30:audit-dry-run") && auditDryRun.includes("phase30:secret-boundary") && auditDryRun.includes("npm.cmd run check"));

console.log("Phase 30 audit persistence dry-run checks passed.");
