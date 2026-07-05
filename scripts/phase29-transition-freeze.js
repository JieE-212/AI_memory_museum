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
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");
const transitionPlan = readText(workspaceRoot, "项目文档", "阶段29收口与阶段30规划.md");

assert("phase 29 remains the active runtime phase", server.includes("const PHASE = 29"));
assert("current build remains frozen at the phase 29 final archive manifest preview", server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes the transition freeze check", packageJson.scripts["phase29:transition-freeze"] === "node scripts/phase29-transition-freeze.js");
assert("README declares the phase 29 transition freeze", readme.includes("Phase 29 transition freeze: active") && readme.includes("no new Phase 29 preview artifacts"));
assert("planning docs point to the transition package", plan.includes("Phase 29 transition freeze: active") && plan.includes("阶段29收口与阶段30规划.md"));
assert("whitepaper explains the phase 30 planning posture", whitepaper.includes("Phase 29 transition freeze: active") && whitepaper.includes("controlled runtime enablement readiness"));
assert("transition plan blocks new phase 29 preview artifacts", transitionPlan.includes("No new Phase 29 preview artifacts."));
assert("transition plan keeps release and runtime disabled", transitionPlan.includes("releaseReady=false") && transitionPlan.includes("phase29ExitReady=false") && transitionPlan.includes("phase30EntryReady=false") && transitionPlan.includes("runtimeExecution=false") && transitionPlan.includes("thirdPartyExecution=false"));
assert("transition plan defines phase 29 exit criteria", transitionPlan.includes("Phase 29 出口标准") && transitionPlan.includes("blocker 清单") && transitionPlan.includes("transition redline") && transitionPlan.includes("release approval"));
assert("transition plan defines phase 30 first increments", transitionPlan.includes("2.0.0 / phase30-entry-baseline") && transitionPlan.includes("2.0.4 / phase30-runtime-go-no-go-board"));
assert("transition plan prevents automatic entry or approval", transitionPlan.includes("自动清除 blocker") && transitionPlan.includes("releaseReady") && transitionPlan.includes("phase30EntryReady"));

console.log("Phase 29 transition freeze checks passed.");
