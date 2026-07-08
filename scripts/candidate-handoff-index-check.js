const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");
const handoffIndexPath = path.join(projectRoot, "项目文档", "当前候选交付变更索引.md");

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

const packageJson = JSON.parse(readText("package.json"));
const readme = readText("README.md");
const handoffIndex = fs.readFileSync(handoffIndexPath, "utf8");

assert("candidate handoff index check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate handoff index check command",
  packageJson.scripts["candidate:handoff-index-check"] === "node scripts/candidate-handoff-index-check.js"
);
assert(
  "check pipeline includes candidate handoff index check",
  packageJson.scripts.check.includes("node scripts/candidate-handoff-index-check.js")
);

assert("handoff index document exists", fs.existsSync(handoffIndexPath));
assert("handoff index names candidate state", handoffIndex.includes("rc-reviewable-but-not-releasable"));
assert("handoff index keeps governance gates blocked", handoffIndex.includes("releaseReady=false") && handoffIndex.includes("phase30EntryReady=false") && handoffIndex.includes("runtimeExecution=false") && handoffIndex.includes("thirdPartyExecution=false"));
assert("handoff index protects live submission boundary", handoffIndex.includes("data/phase30-human-evidence-submission.json") && handoffIndex.includes("真实 reviewer 输出"));
assert("handoff index summarizes items 1 through 9", Array.from({ length: 9 }, (_, index) => `${index + 1}. `).every((marker) => handoffIndex.includes(marker)));
assert("handoff index references candidate scripts", ["candidate:delivery-ui-check", "candidate:user-path-check", "candidate:import-path-check", "phase30:evidence-closure-status"].every((command) => handoffIndex.includes(command)));
assert("handoff index references key changed files", ["README.md", "index.html", "app.js", "styles.css", "package.json"].every((file) => handoffIndex.includes(file)));
assert("handoff index includes full check command", handoffIndex.includes("npm.cmd run check"));
assert("handoff index says it is not release approval", handoffIndex.includes("不是 release approval"));
assert("README links candidate handoff index", readme.includes("Current candidate delivery change index") && readme.includes("项目文档/当前候选交付变更索引.md"));
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate handoff index checks passed.");
