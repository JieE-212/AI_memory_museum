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
const planningClosure = readText(workspaceRoot, "项目文档", "阶段30第一轮规划收口.md");
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");

assert("phase 30 planning closure does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 planning closure does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 planning closure check", packageJson.scripts["phase30:planning-closure"] === "node scripts/phase30-planning-closure.js");
assert("check pipeline includes phase 30 planning closure", packageJson.scripts.check.includes("node scripts/phase30-planning-closure.js"));
assert("README declares phase 30 planning closure", readme.includes("Phase 30 first-round planning closure: active") && readme.includes("human review only"));
assert("project plan links to planning closure", plan.includes("Phase 30 first-round planning closure: active") && plan.includes("阶段30第一轮规划收口.md"));
assert("whitepaper explains planning closure is not runtime enablement", whitepaper.includes("Phase 30 first-round planning closure: active") && whitepaper.includes("不代表运行时可以打开"));
assert("transition plan links to planning closure", transitionPlan.includes("阶段30第一轮规划收口.md") && transitionPlan.includes("第一轮规划收口"));
assert("planning baseline references planning closure", phase30Plan.includes("2.0.5 / phase30-first-round-planning-closure") && phase30Plan.includes("阶段30第一轮规划收口.md"));
assert("entry baseline references planning closure", entryBaseline.includes("阶段30第一轮规划收口.md") && entryBaseline.includes("closed-for-human-review-only"));
assert("sandbox harness references planning closure", sandboxHarness.includes("阶段30第一轮规划收口.md") && sandboxHarness.includes("human-review-handoff"));
assert("secret boundary references planning closure", secretBoundary.includes("阶段30第一轮规划收口.md") && secretBoundary.includes("human-review-handoff"));
assert("audit dry-run references planning closure", auditDryRun.includes("阶段30第一轮规划收口.md") && auditDryRun.includes("human-review-handoff"));
assert("go/no-go board references planning closure", goNoGoBoard.includes("阶段30第一轮规划收口.md") && goNoGoBoard.includes("Phase 30 first-round planning closure"));
assert("planning closure declares 2.0.5 identity", planningClosure.includes("2.0.5 / phase30-first-round-planning-closure") && planningClosure.includes("Phase 30 first-round planning closure: active"));
assert("planning closure remains human review only", planningClosure.includes("Phase 30 planning remains closed for human review only."));
assert("planning closure preserves disabled state", planningClosure.includes("releaseReady=false") && planningClosure.includes("phase29ExitReady=false") && planningClosure.includes("phase30EntryReady=false") && planningClosure.includes("runtimeExecution=false") && planningClosure.includes("thirdPartyExecution=false"));
assert("planning closure blocks runtime approval", planningClosure.includes("No runtime approval in phase30-first-round-planning-closure."));
assert("planning closure lists completed planning chain", planningClosure.includes("2.0.0 / phase30-entry-baseline") && planningClosure.includes("2.0.4 / phase30-runtime-go-no-go-board"));
assert("planning closure defaults to human-review-only", planningClosure.includes("closed-for-human-review-only") && planningClosure.includes("no-go-blocked"));
assert("planning closure keeps go decision blocked", planningClosure.includes("Runtime go decision remains blocked") && planningClosure.includes("runtimeMutationCount=0"));
assert("planning closure defines human action list", planningClosure.includes("release owner") && planningClosure.includes("runtime owner") && planningClosure.includes("security reviewer") && planningClosure.includes("data steward") && planningClosure.includes("audit reviewer"));
assert("planning closure defines hard blockers", planningClosure.includes("enable-runtimeExecution") && planningClosure.includes("execute-real-third-party-plugin") && planningClosure.includes("convert-planning-closure-to-release-approval"));
assert("planning closure defines next-step boundary", planningClosure.includes("human-review-handoff") && planningClosure.includes("implementation-entry-design"));
assert("planning closure defines completion standard", planningClosure.includes("phase30:planning-closure") && planningClosure.includes("phase30:go-no-go-board") && planningClosure.includes("npm.cmd run check"));

console.log("Phase 30 first-round planning closure checks passed.");
