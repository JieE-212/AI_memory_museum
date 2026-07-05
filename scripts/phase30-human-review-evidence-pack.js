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
const operations = readText(projectRoot, "src", "services", "operations.js");
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
const evidencePack = readText(workspaceRoot, "项目文档", "阶段30人工复核证据包.md");
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");

assert("phase 30 human review evidence pack does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 human review evidence pack does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 human review evidence pack check", packageJson.scripts["phase30:human-review-evidence-pack"] === "node scripts/phase30-human-review-evidence-pack.js");
assert("check pipeline includes phase 30 human review evidence pack", packageJson.scripts.check.includes("node scripts/phase30-human-review-evidence-pack.js"));
assert("README declares phase 30 human review evidence pack", readme.includes("Phase 30 human review evidence pack: active") && readme.includes("Human evidence remains pending"));
assert("README declares phase 30 human review execution ledger", readme.includes("Phase 30 human review execution ledger: active") && readme.includes("phase30.human-review-execution-ledger.v1"));
assert("project plan links to human review evidence pack", plan.includes("Phase 30 human review evidence pack: active") && plan.includes("阶段30人工复核证据包.md"));
assert("project plan declares human review execution ledger", plan.includes("Phase 30 human review execution ledger: active") && plan.includes("phase30.human-review-execution-ledger.v1"));
assert("whitepaper explains evidence pack is not signoff", whitepaper.includes("Phase 30 human review evidence pack: active") && whitepaper.includes("不代表人工签核已经完成"));
assert("whitepaper explains execution ledger is not signoff", whitepaper.includes("Phase 30 human review execution ledger: active") && whitepaper.includes("所有证据仍为 pending"));
assert("transition plan links to human review evidence pack", transitionPlan.includes("阶段30人工复核证据包.md") && transitionPlan.includes("人工复核证据包"));
assert("planning baseline references human review evidence pack", phase30Plan.includes("2.0.6 / phase30-human-review-evidence-pack") && phase30Plan.includes("阶段30人工复核证据包.md"));
assert("entry baseline references human review evidence pack", entryBaseline.includes("阶段30人工复核证据包.md") && entryBaseline.includes("Human evidence remains pending"));
assert("sandbox harness references human review evidence pack", sandboxHarness.includes("阶段30人工复核证据包.md") && sandboxHarness.includes("sandbox-acceptance-review"));
assert("secret boundary references human review evidence pack", secretBoundary.includes("阶段30人工复核证据包.md") && secretBoundary.includes("secret-boundary-review"));
assert("audit dry-run references human review evidence pack", auditDryRun.includes("阶段30人工复核证据包.md") && auditDryRun.includes("audit-dry-run-review"));
assert("go/no-go board references human review evidence pack", goNoGoBoard.includes("阶段30人工复核证据包.md") && goNoGoBoard.includes("Human evidence remains pending"));
assert("planning closure references human review evidence pack", planningClosure.includes("阶段30人工复核证据包.md") && planningClosure.includes("phase30-human-review-evidence-pack"));
assert("evidence pack declares 2.0.6 identity", evidencePack.includes("2.0.6 / phase30-human-review-evidence-pack") && evidencePack.includes("Phase 30 human review evidence pack: active"));
assert("evidence pack keeps evidence pending", evidencePack.includes("Human evidence remains pending."));
assert("evidence pack declares execution ledger", evidencePack.includes("phase30.human-review-execution-ledger.v1") && evidencePack.includes("readonly-human-review-execution-ledger-no-signoff"));
assert("evidence pack preserves disabled state", evidencePack.includes("releaseReady=false") && evidencePack.includes("phase29ExitReady=false") && evidencePack.includes("phase30EntryReady=false") && evidencePack.includes("runtimeExecution=false") && evidencePack.includes("thirdPartyExecution=false"));
assert("evidence pack blocks signoff grant", evidencePack.includes("No human signoff is granted by phase30-human-review-evidence-pack."));
assert("evidence pack references planning closure", evidencePack.includes("2.0.5 / phase30-first-round-planning-closure") && evidencePack.includes("closed-for-human-review-only"));
assert("evidence pack defines evidence slots", evidencePack.includes("evidenceId") && evidencePack.includes("currentDisposition") && evidencePack.includes("evidenceRef") && evidencePack.includes("blocksRuntime"));
assert("evidence pack defaults all slots pending", evidencePack.includes("currentDisposition=pending") && evidencePack.includes("evidenceRef=missing") && evidencePack.includes("reviewer=unassigned"));
assert("evidence pack defines required evidence list", evidencePack.includes("release-blocker-disposition") && evidencePack.includes("runtime-owner-go-no-go") && evidencePack.includes("sandbox-acceptance-review") && evidencePack.includes("audit-dry-run-review"));
assert("evidence pack defines allowed dispositions", evidencePack.includes("approved-with-evidence") && evidencePack.includes("accepted-with-risk") && evidencePack.includes("deferred-with-owner") && evidencePack.includes("blocked"));
assert("evidence pack keeps pending as blocking", evidencePack.includes("任何 `pending`") && evidencePack.includes("继续阻断 runtime"));
assert("evidence pack defines minimal review record", evidencePack.includes('"evidenceId": "runtime-owner-go-no-go"') && evidencePack.includes('"blocksPhase30Entry": true'));
assert("evidence pack defines forbidden actions", evidencePack.includes("auto-approve-human-signoff") && evidencePack.includes("convert-check-pass-to-human-evidence") && evidencePack.includes("enable-runtimeExecution"));
assert("evidence pack defines completion standard", evidencePack.includes("phase30:human-review-evidence-pack") && evidencePack.includes("phase30:planning-closure") && evidencePack.includes("npm.cmd run check"));
assert("operations exposes human review execution ledger", operations.includes("buildPhase30HumanReviewExecutionLedger") && operations.includes("phase30HumanReviewExecutionLedger") && operations.includes("phase30.human-review-execution-ledger.v1"));
assert("operations ledger keeps all human evidence pending", operations.includes("pendingSlots") && operations.includes("approvedSlots") && operations.includes("evidenceRef: \"missing\"") && operations.includes("reviewer: \"unassigned\""));
assert("operations ledger remains read-only and blocking", operations.includes("readonly-human-review-execution-ledger-no-signoff") && operations.includes("blockedRuntimeSlots") && operations.includes("blockedReleaseSlots") && operations.includes("blockedPhase30EntrySlots"));
assert("operations ledger blocks runtime and release mutations", operations.includes("auto-approve-human-signoff") && operations.includes("mark-releaseReady-true") && operations.includes("enable-runtimeExecution") && operations.includes("execute-real-third-party-plugin"));

console.log("Phase 30 human review evidence pack checks passed.");
