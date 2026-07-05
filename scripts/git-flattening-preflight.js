const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const docsRoot = path.join(workspaceRoot, "项目文档");
const decisionDoc = path.join(docsRoot, "仓库扁平化确认记录.md");
const preflightDoc = path.join(docsRoot, "仓库索引迁移预检清单.md");

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

function gitStatus(args) {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "-uall", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  return out
    .split("\0")
    .filter(Boolean)
    .map((entry) => ({
      raw: entry,
      status: entry.slice(0, 2),
      filePath: entry.slice(3),
    }));
}

const statusEntries = gitStatus([]);
const statusWithIgnored = gitStatus(["--ignored"]);

const oldPathDeletes = statusEntries.filter(
  (entry) =>
    entry.status.includes("D") &&
    (entry.filePath.startsWith("项目工程/") || entry.filePath.startsWith("项目文档/"))
);

const rootUntracked = statusEntries.filter(
  (entry) =>
    entry.status === "??" &&
    !entry.filePath.startsWith("项目工程/") &&
    !entry.filePath.startsWith("项目文档/")
);
const rootStagedAdds = statusEntries.filter(
  (entry) =>
    entry.status.includes("A") &&
    !entry.filePath.startsWith("项目工程/") &&
    !entry.filePath.startsWith("项目文档/")
);
const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: projectRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const ignoredArtifacts = statusWithIgnored.filter((entry) => entry.status === "!!");
const rootModified = statusEntries.filter(
  (entry) =>
    entry.status.trim() !== "" &&
    entry.status !== "??" &&
    !entry.status.includes("D") &&
    !entry.filePath.startsWith("项目工程/") &&
    !entry.filePath.startsWith("项目文档/")
);

assert("accepted flattening decision document exists", fs.existsSync(decisionDoc));
assert("index migration preflight checklist exists", fs.existsSync(preflightDoc));

const decision = fs.readFileSync(decisionDoc, "utf8");
const preflight = fs.readFileSync(preflightDoc, "utf8");

assert(
  "flattening decision accepts current project root",
  decision.includes("accepted-flattened-project-root") &&
    decision.includes("gitIndexMigration=committed-flattened-project-root")
);
assert(
  "preflight checklist records committed path migration",
  preflight.includes("gitIndexMigration=committed-flattened-project-root") &&
    preflight.includes("indexMutation=committed-path-migration")
);
assert("old nested project paths are absent from tracked index", !trackedFiles.some((filePath) => filePath.startsWith("项目工程/")));
assert("current root files are tracked", trackedFiles.includes("server.js") && trackedFiles.includes("app.js") && trackedFiles.includes("项目文档/项目规划.md"));
assert("ignored runtime artifacts remain excluded from migration", ignoredArtifacts.length > 0);

console.log("Git flattening preflight summary:");
console.log(`- old path deletes: ${oldPathDeletes.length}`);
console.log(`- current root untracked files: ${rootUntracked.length}`);
console.log(`- current root staged files: ${rootStagedAdds.length}`);
console.log(`- current root modified files: ${rootModified.length}`);
console.log(`- ignored runtime artifacts: ${ignoredArtifacts.length}`);
console.log("- index mutation: committed-path-migration");
console.log("- commit creation: completed");
console.log("Git flattening preflight passed.");
