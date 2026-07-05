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
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");

assert("phase 30 planning does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 planning does not change the current version", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"'));
assert("phase 30 planning does not change the current build label", server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 planning readiness", packageJson.scripts["phase30:planning"] === "node scripts/phase30-planning-readiness.js");
assert("README declares phase 30 planning baseline", readme.includes("Phase 30 planning baseline: active") && readme.includes("planning-only work"));
assert("transition plan links to phase 30 planning baseline", transitionPlan.includes("阶段30规划基线.md") && transitionPlan.includes("不代表 Phase 30 已经进入实现"));
assert("project plan links to phase 30 planning baseline", plan.includes("Phase 30 planning baseline: active") && plan.includes("阶段30规划基线.md"));
assert("whitepaper keeps phase 30 in planning state", whitepaper.includes("Phase 30 planning baseline: active") && whitepaper.includes("不代表已经进入 Phase 30 实现"));
assert("phase 30 plan declares planning only", phase30Plan.includes("Phase 30 planning baseline: active") && phase30Plan.includes("Phase 30 entry is not active."));
assert("phase 30 plan keeps release and runtime disabled", phase30Plan.includes("releaseReady=false") && phase30Plan.includes("phase29ExitReady=false") && phase30Plan.includes("phase30EntryReady=false") && phase30Plan.includes("runtimeExecution=false") && phase30Plan.includes("thirdPartyExecution=false"));
assert("phase 30 plan names the controlled runtime theme", phase30Plan.includes("controlled runtime enablement readiness"));
assert("phase 30 plan defines input sources", phase30Plan.includes("release exit final archive manifest preview") && phase30Plan.includes("phase30 entry preflight preview"));
assert("phase 30 plan defines entry conditions", phase30Plan.includes("Phase 30 入口条件") && phase30Plan.includes("release approval 与 runtime enablement 分开签核"));
assert("phase 30 plan defines version path", phase30Plan.includes("2.0.0 / phase30-entry-baseline") && phase30Plan.includes("2.0.4 / phase30-runtime-go-no-go-board"));
assert("phase 30 plan blocks runtime execution during planning", phase30Plan.includes("No runtime execution in Phase 30 planning."));
assert("phase 30 plan prevents automatic approval", phase30Plan.includes("检查脚本只能验证规划是否完整，不能把任何 readiness 改为 true"));
assert("phase 30 plan defines completion checks", phase30Plan.includes("npm.cmd run phase30:planning") && phase30Plan.includes("npm.cmd run check"));

console.log("Phase 30 planning readiness checks passed.");
