const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const docsRoot = path.join(projectRoot, "项目文档");
const outsideDocsRoot = path.join(workspaceRoot, "项目文档");

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

function git(args) {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" });
}

function gitLines(args) {
  return git(args)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitEntries(args) {
  return git([...args, "-z"]).split("\0").filter(Boolean);
}

function hasStagedChanges() {
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: projectRoot });
    return false;
  } catch {
    return true;
  }
}

const trackedFiles = gitEntries(["ls-files"]);
const stagedNameStatus = gitLines(["diff", "--cached", "--name-status"]);
const statusEntries = gitLines(["status", "--porcelain=v1", "-uall"]);

const requiredRootFiles = [
  ".env.example",
  ".gitignore",
  "README.md",
  "app.js",
  "database.js",
  "index.html",
  "package.json",
  "server.js",
  "styles.css",
  "scripts/api-smoke.js",
  "scripts/docs-ownership-check.js",
  "scripts/git-flattening-index-staged-check.js",
  "scripts/git-flattening-migration-plan.js",
  "scripts/git-flattening-preflight.js",
  "src/routes/health.js",
  "src/routes/operations.js",
  "src/services/operations.js",
  "项目文档/项目规划.md",
  "项目文档/项目白皮书.md",
  "项目文档/文档归属决策记录.md",
  "项目文档/阶段30收口审查包.md",
];

const forbiddenTrackedPrefixes = ["项目工程/"];
const forbiddenTrackedFiles = [
  "data/memory-museum.sqlite",
  "data/operations-events.jsonl",
  "operations-debug.json",
  "operations-export-debug.json",
];

assert("index migration commit leaves no staged changes", !hasStagedChanges());
assert(
  "old nested project paths are removed from the index",
  !trackedFiles.some((filePath) => forbiddenTrackedPrefixes.some((prefix) => filePath.startsWith(prefix)))
);
assert(
  "required root project files are tracked in the index",
  requiredRootFiles.every((filePath) => trackedFiles.includes(filePath))
);
assert(
  "runtime artifacts remain untracked",
  forbiddenTrackedFiles.every((filePath) => !trackedFiles.includes(filePath))
);
assert(
  "no document path is staged for deletion",
  !stagedNameStatus.some((line) => line.startsWith("D\t项目文档/"))
);
assert(
  "essential root files are no longer untracked",
  !statusEntries.some((line) => line.startsWith("?? server.js") || line.startsWith("?? scripts/") || line.startsWith("?? src/"))
);
assert("in-repo document directory exists", fs.existsSync(docsRoot));
assert("outside document mirror remains available", fs.existsSync(outsideDocsRoot));

const server = fs.readFileSync(path.join(projectRoot, "server.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const closureReview = fs.readFileSync(path.join(docsRoot, "阶段30收口审查包.md"), "utf8");

assert("runtime phase remains phase 29", server.includes("const PHASE = 29"));
assert("version remains 1.9.48", packageJson.version === "1.9.48");
assert(
  "release and runtime guardrails remain documented as closed",
  closureReview.includes("releaseReady=false") &&
    closureReview.includes("phase29ExitReady=false") &&
    closureReview.includes("phase30EntryReady=false") &&
    closureReview.includes("runtimeExecution=false") &&
    closureReview.includes("thirdPartyExecution=false")
);

console.log("Git flattening staged index summary:");
console.log(`- tracked files: ${trackedFiles.length}`);
console.log(`- staged entries: ${stagedNameStatus.length}`);
console.log("- old 项目工程/ paths tracked: 0");
console.log("- path migration commit: created");
console.log("- release commit: not created");
console.log("Git flattening committed index checks passed.");
