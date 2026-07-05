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
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");

assert("phase 30 entry baseline does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 entry baseline does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 entry baseline check", packageJson.scripts["phase30:entry-baseline"] === "node scripts/phase30-entry-baseline.js");
assert("check pipeline includes phase 30 entry baseline", packageJson.scripts.check.includes("node scripts/phase30-entry-baseline.js"));
assert("README declares phase 30 entry baseline", readme.includes("Phase 30 entry baseline: active") && readme.includes("Phase 30 entry remains inactive"));
assert("project plan links to phase 30 entry baseline", plan.includes("Phase 30 entry baseline: active") && plan.includes("阶段30入口基线.md"));
assert("whitepaper explains entry baseline is not runtime enablement", whitepaper.includes("Phase 30 entry baseline: active") && whitepaper.includes("这不是运行时启用"));
assert("transition plan links to phase 30 entry baseline", transitionPlan.includes("阶段30入口基线.md") && transitionPlan.includes("不激活 Phase 30 entry"));
assert("planning baseline references entry baseline document", phase30Plan.includes("阶段30入口基线.md") && phase30Plan.includes("不代表 Phase 30 entry 已经激活"));
assert("entry baseline declares 2.0.0 identity", entryBaseline.includes("2.0.0 / phase30-entry-baseline") && entryBaseline.includes("Phase 30 entry baseline: active"));
assert("entry baseline keeps phase 30 inactive", entryBaseline.includes("Phase 30 entry remains inactive."));
assert("entry baseline preserves disabled state", entryBaseline.includes("releaseReady=false") && entryBaseline.includes("phase29ExitReady=false") && entryBaseline.includes("phase30EntryReady=false") && entryBaseline.includes("runtimeExecution=false") && entryBaseline.includes("thirdPartyExecution=false"));
assert("entry baseline blocks runtime execution", entryBaseline.includes("No runtime execution in phase30-entry-baseline."));
assert("entry baseline lists phase 29 frozen inputs", entryBaseline.includes("Phase 29 冻结输入引用") && entryBaseline.includes("release exit final archive manifest preview") && entryBaseline.includes("phase30 entry preflight preview"));
assert("entry baseline defines scope lock", entryBaseline.includes("Scope Lock") && entryBaseline.includes("包含范围") && entryBaseline.includes("排除范围"));
assert("entry baseline defines entry gates", entryBaseline.includes("入口 Gate 清单") && entryBaseline.includes("runtime-enable-approved") && entryBaseline.includes("third-party-execution-approved"));
assert("entry baseline defines risk register", entryBaseline.includes("风险登记") && entryBaseline.includes("sandbox isolation 尚未验收") && entryBaseline.includes("preview 被误当作批准证据"));
assert("entry baseline defines manual signoff placeholders", entryBaseline.includes("人工签核占位") && entryBaseline.includes("release owner") && entryBaseline.includes("runtime owner") && entryBaseline.includes("security reviewer"));
assert("entry baseline defines next sandbox acceptance criteria", entryBaseline.includes("2.0.1 / phase30-runtime-sandbox-acceptance-harness") && entryBaseline.includes("使用 fixture 插件") && entryBaseline.includes("不执行真实第三方代码"));
assert("entry baseline defines completion standard", entryBaseline.includes("phase30:entry-baseline") && entryBaseline.includes("phase29:transition-freeze") && entryBaseline.includes("npm.cmd run check"));

console.log("Phase 30 entry baseline checks passed.");
