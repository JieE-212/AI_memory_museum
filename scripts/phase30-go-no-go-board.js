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
const goNoGoBoard = readText(workspaceRoot, "项目文档", "阶段30运行时GoNoGo看板.md");
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");

assert("phase 30 go/no-go board does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 go/no-go board does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 go/no-go board check", packageJson.scripts["phase30:go-no-go-board"] === "node scripts/phase30-go-no-go-board.js");
assert("check pipeline includes phase 30 go/no-go board", packageJson.scripts.check.includes("node scripts/phase30-go-no-go-board.js"));
assert("README declares phase 30 go/no-go board", readme.includes("Phase 30 runtime go/no-go board: active") && readme.includes("runtime approval remains blocked"));
assert("project plan links to go/no-go board", plan.includes("Phase 30 runtime go/no-go board: active") && plan.includes("阶段30运行时GoNoGo看板.md"));
assert("whitepaper explains go/no-go board is blocked", whitepaper.includes("Phase 30 runtime go/no-go board: active") && whitepaper.includes("no-go-blocked"));
assert("transition plan links to go/no-go board", transitionPlan.includes("阶段30运行时GoNoGo看板.md") && transitionPlan.includes("不批准发布、不启用运行时"));
assert("planning baseline references go/no-go board", phase30Plan.includes("2.0.4 / phase30-runtime-go-no-go-board") && phase30Plan.includes("阶段30运行时GoNoGo看板.md"));
assert("entry baseline references go/no-go board", entryBaseline.includes("阶段30运行时GoNoGo看板.md") && entryBaseline.includes("runtimeMutationCount"));
assert("sandbox harness links to go/no-go board", sandboxHarness.includes("阶段30运行时GoNoGo看板.md") && sandboxHarness.includes("runtime approval"));
assert("secret boundary links to go/no-go board", secretBoundary.includes("阶段30运行时GoNoGo看板.md") && secretBoundary.includes("secret access 仍保持 blocked"));
assert("audit dry-run links to go/no-go board", auditDryRun.includes("阶段30运行时GoNoGo看板.md") && auditDryRun.includes("audit export"));
assert("go/no-go board declares 2.0.4 identity", goNoGoBoard.includes("2.0.4 / phase30-runtime-go-no-go-board") && goNoGoBoard.includes("Phase 30 runtime go/no-go board: active"));
assert("go/no-go board keeps runtime blocked", goNoGoBoard.includes("Runtime go decision remains blocked."));
assert("go/no-go board preserves disabled state", goNoGoBoard.includes("releaseReady=false") && goNoGoBoard.includes("phase29ExitReady=false") && goNoGoBoard.includes("phase30EntryReady=false") && goNoGoBoard.includes("runtimeExecution=false") && goNoGoBoard.includes("thirdPartyExecution=false"));
assert("go/no-go board blocks runtime approval", goNoGoBoard.includes("No runtime approval in phase30-runtime-go-no-go-board."));
assert("go/no-go board defines input sources", goNoGoBoard.includes("阶段30入口基线.md") && goNoGoBoard.includes("阶段30审计持久化演练.md") && goNoGoBoard.includes("Phase 29 final release blocker dossier"));
assert("go/no-go board defines summary signals", goNoGoBoard.includes("sandboxAcceptance") && goNoGoBoard.includes("secretBoundary") && goNoGoBoard.includes("auditDryRun") && goNoGoBoard.includes("runtimeMutationCount"));
assert("go/no-go board defines allowed statuses", goNoGoBoard.includes("no-go-blocked") && goNoGoBoard.includes("hold-human-review-required") && goNoGoBoard.includes("ready-for-human-review-only"));
assert("go/no-go board defaults to no-go blocked", goNoGoBoard.includes("本版本默认结论为") && goNoGoBoard.includes("`no-go-blocked`"));
assert("go/no-go board defines board fields", goNoGoBoard.includes("boardId") && goNoGoBoard.includes("decisionReason") && goNoGoBoard.includes("manualReviewQueue"));
assert("go/no-go board defines manual review queue", goNoGoBoard.includes("release owner") && goNoGoBoard.includes("runtime owner") && goNoGoBoard.includes("security reviewer") && goNoGoBoard.includes("audit reviewer"));
assert("go/no-go board defines forbidden actions", goNoGoBoard.includes("mark-releaseReady-true") && goNoGoBoard.includes("enable-runtimeExecution") && goNoGoBoard.includes("convert-pass-dry-run-to-runtime-approval"));
assert("go/no-go board recommends human work before implementation", goNoGoBoard.includes("Phase 30 implementation entry") && goNoGoBoard.includes("blocker disposition") && goNoGoBoard.includes("security reviewer signoff"));
assert("go/no-go board defines completion standard", goNoGoBoard.includes("phase30:go-no-go-board") && goNoGoBoard.includes("phase30:audit-dry-run") && goNoGoBoard.includes("npm.cmd run check"));

console.log("Phase 30 runtime go/no-go board checks passed.");
