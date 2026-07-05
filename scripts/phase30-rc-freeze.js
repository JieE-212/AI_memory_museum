const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");

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

function git(args) {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
}

const server = readText(projectRoot, "server.js");
const packageJson = JSON.parse(readText(projectRoot, "package.json"));
const rcBrief = readText(docsRoot, "阶段30候选交付说明.md");
const rcFreeze = readText(docsRoot, "阶段30RC冻结清单.md");
const closureReview = readText(docsRoot, "阶段30收口审查包.md");
const evidencePack = readText(docsRoot, "阶段30人工复核证据包.md");
const evidenceWorksheet = readText(docsRoot, "阶段30人工复核证据填写表.md");
const intakeRegister = readText(docsRoot, "阶段30人工证据收集登记表.md");

assert("phase 30 RC freeze does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 RC freeze does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"'));
assert("package exposes phase 30 RC freeze check", packageJson.scripts["phase30:rc-freeze"] === "node scripts/phase30-rc-freeze.js");
assert("package exposes phase 30 evidence intake register", packageJson.scripts["phase30:evidence-intake-register"] === "node scripts/phase30-evidence-intake-register.js");
assert("check pipeline includes phase 30 RC freeze", packageJson.scripts.check.includes("node scripts/phase30-rc-freeze.js"));
assert("check pipeline includes phase 30 evidence intake register", packageJson.scripts.check.includes("node scripts/phase30-evidence-intake-register.js"));
assert("path flattening commit exists in history", git(["log", "--oneline", "--grep", "chore: flatten project repository paths"]).includes("chore: flatten project repository paths"));
assert("RC freeze checklist declares identity", rcFreeze.includes("2.0.9 / phase30-rc-freeze-checklist") && rcFreeze.includes("Phase 30 RC freeze checklist: active"));
assert("RC freeze remains not releasable", rcFreeze.includes("rc-reviewable-but-not-releasable") && rcFreeze.includes("不是 release approval"));
assert("RC freeze records committed path migration", rcFreeze.includes("gitIndexMigration=committed-flattened-project-root") && rcFreeze.includes("8d3ffdf"));
assert("RC freeze preserves guardrails", rcFreeze.includes("releaseReady=false") && rcFreeze.includes("phase29ExitReady=false") && rcFreeze.includes("phase30EntryReady=false") && rcFreeze.includes("runtimeExecution=false") && rcFreeze.includes("thirdPartyExecution=false"));
assert("RC freeze points to evidence intake plan", rcFreeze.includes("阶段30人工证据收集计划.md"));
assert("RC freeze points to evidence intake register", rcFreeze.includes("阶段30人工证据收集登记表.md") && rcFreeze.includes("phase30:evidence-intake-register"));
assert("RC brief remains not releasable", rcBrief.includes("rc-reviewable-but-not-releasable") && rcBrief.includes("Phase 30 release candidate brief is not release approval"));
assert("closure review keeps release and runtime blocked", closureReview.includes("releaseReady=false") && closureReview.includes("runtimeExecution=false") && closureReview.includes("thirdPartyExecution=false"));
assert("human evidence pack remains pending", evidencePack.includes("Human evidence remains pending") && evidencePack.includes("pendingSlots=10"));
assert("human evidence worksheet remains pending template", evidenceWorksheet.includes("pending") && evidenceWorksheet.includes("Phase 30 human review evidence worksheet is not human signoff"));
assert("human evidence intake register remains pending", intakeRegister.includes("pendingSlots=10") && intakeRegister.includes("approvedSlots=0") && intakeRegister.includes("no automatic approval"));

console.log("Phase 30 RC freeze checks passed.");
