const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");
const candidateCommit = "435b1d8";

const expectedFiles = {
  root: ["README.md", "app.js", "index.html", "package.json", "styles.css"],
  scripts: [
    "scripts/candidate-delivery-ui-check.js",
    "scripts/candidate-final-review-package-lock-check.js",
    "scripts/candidate-handoff-index-check.js",
    "scripts/candidate-import-path-check.js",
    "scripts/candidate-maintainer-conversion-authorization-check.js",
    "scripts/candidate-negative-misuse-check.js",
    "scripts/candidate-pre-review-package-check.js",
    "scripts/candidate-review-chain-integrity-check.js",
    "scripts/candidate-review-dry-run-record-check.js",
    "scripts/candidate-review-execution-sequence-check.js",
    "scripts/candidate-reviewer-handoff-execution-check.js",
    "scripts/candidate-reviewer-handoff-receipt-check.js",
    "scripts/candidate-reviewer-in-review-blocker-clarification-check.js",
    "scripts/candidate-reviewer-output-field-fix-assignment-check.js",
    "scripts/candidate-reviewer-output-field-fix-receipt-retry-readiness-check.js",
    "scripts/candidate-reviewer-output-field-gap-matrix-check.js",
    "scripts/candidate-reviewer-output-receipt-attempt-log-check.js",
    "scripts/candidate-reviewer-output-receipt-check.js",
    "scripts/candidate-reviewer-output-reconciliation-failure-disposition-check.js",
    "scripts/candidate-reviewer-output-reconciliation-failure-disposition-outcome-check.js",
    "scripts/candidate-reviewer-output-reconciliation-rerun-execution-check.js",
    "scripts/candidate-reviewer-output-reconciliation-rerun-readiness-check.js",
    "scripts/candidate-reviewer-output-reconciliation-rerun-result-intake-check.js",
    "scripts/candidate-reviewer-output-reconciliation-rerun-result-review-check.js",
    "scripts/candidate-reviewer-output-retry-batch-attempt-reconciliation-check.js",
    "scripts/candidate-reviewer-output-retry-batch-register-check.js",
    "scripts/candidate-reviewer-output-return-resubmission-closure-check.js",
    "scripts/candidate-reviewer-output-summary-template-check.js",
    "scripts/candidate-reviewer-review-start-confirmation-check.js",
    "scripts/candidate-reviewer-workbench-check.js",
    "scripts/candidate-user-path-check.js",
    "scripts/phase30-human-evidence-closure-status.js",
  ],
};

const requiredDocs = [
  "阶段30候选交付提交后审阅包.md",
  "阶段30候选交付CommitDiff摘要.md",
  "阶段30候选交付收口清单.md",
  "阶段30候选交付深度审计记录.md",
  "后续任务长跑执行记录.md",
  "当前候选交付人工审查包最终锁定索引.md",
  "当前候选交付负向用例防误用检查.md",
  "当前候选交付Reviewer输出再对账结果复核记录.md",
];

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function git(args) {
  return childProcess.execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
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
const server = readText("server.js");
const handoff = fs.readFileSync(path.join(docsRoot, "阶段30候选交付提交后审阅包.md"), "utf8");
const diffSummary = fs.readFileSync(path.join(docsRoot, "阶段30候选交付CommitDiff摘要.md"), "utf8");
const commitSubject = git(["show", "--no-patch", "--format=%s", candidateCommit]).trim();
const commitFiles = git(["show", "--name-only", "--format=", candidateCommit])
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const commitStat = git(["show", "--shortstat", "--format=", candidateCommit]);
const staged = git(["diff", "--name-only", "--cached"]).trim();

assert("phase 30 post commit handoff does not change active phase", server.includes("const PHASE = 29"));
assert("phase 30 post commit handoff does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes phase 30 post commit review handoff",
  packageJson.scripts["phase30:post-commit-review-handoff"] ===
    "node scripts/phase30-post-commit-review-handoff.js"
);
assert(
  "check pipeline includes phase 30 post commit review handoff",
  packageJson.scripts.check.includes("node scripts/phase30-post-commit-review-handoff.js")
);
assert("candidate commit exists", commitSubject === "chore: stage phase 30 candidate review package");
assert("candidate commit has expected file count", commitFiles.length === 74);
assert("candidate commit has expected root files", expectedFiles.root.every((file) => commitFiles.includes(file)));
assert("candidate commit has expected script files", expectedFiles.scripts.every((file) => commitFiles.includes(file)));
assert("candidate commit keeps data files out", commitFiles.every((file) => !file.startsWith("data/")));
assert("candidate commit stat is stable", commitStat.includes("74 files changed") && commitStat.includes("13930 insertions") && commitStat.includes("47 deletions"));
assert("post commit handoff leaves no staged changes", staged.length === 0);
assert("post commit handoff keeps live submission absent", !fs.existsSync(liveSubmissionPath));
assert(
  "README declares post commit review handoff",
  readme.includes("Phase 30 candidate post-commit review handoff: active") &&
    readme.includes("2.0.27 / phase30-candidate-post-commit-review-handoff")
);
assert(
  "handoff declares identity and commit",
  handoff.includes("2.0.27 / phase30-candidate-post-commit-review-handoff") &&
    handoff.includes("post-commit-review-handoff-only") &&
    handoff.includes(candidateCommit)
);
assert(
  "handoff preserves guardrails",
  handoff.includes("releaseReady=false") &&
    handoff.includes("phase29ExitReady=false") &&
    handoff.includes("phase30EntryReady=false") &&
    handoff.includes("runtimeExecution=false") &&
    handoff.includes("thirdPartyExecution=false")
);
assert(
  "handoff blocks false conversion",
  handoff.includes("不得默认创建 `data/phase30-human-evidence-submission.json`") &&
    handoff.includes("不得设置 `releaseReady=true`") &&
    handoff.includes("不得启用 `runtimeExecution`")
);
assert(
  "diff summary declares commit boundary",
  diffSummary.includes("commit-diff-summary-only") &&
    diffSummary.includes(candidateCommit) &&
    diffSummary.includes("changed files：`74`") &&
    diffSummary.includes("committed `data/` files：`0`")
);
assert(
  "diff summary blocks release interpretation",
  diffSummary.includes("不是 release approval") &&
    diffSummary.includes("未创建 `data/phase30-human-evidence-submission.json`")
);
assert("required post commit docs exist", requiredDocs.every((file) => fs.existsSync(path.join(docsRoot, file))));

console.log("Phase 30 post-commit review handoff checks passed.");
