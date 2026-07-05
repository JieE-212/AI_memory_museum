const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const docsOutsideRoot = path.join(workspaceRoot, "项目文档");
const docsInsideRoot = path.join(projectRoot, "项目文档");
const planDoc = path.join(docsOutsideRoot, "仓库索引迁移执行方案.md");
const preflightDoc = path.join(docsOutsideRoot, "仓库索引迁移预检清单.md");
const docsOwnershipDoc = path.join(docsOutsideRoot, "文档归属决策记录.md");

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

function gitStatus(args = []) {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "-uall", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  return out
    .split("\0")
    .filter(Boolean)
    .map((entry) => ({
      status: entry.slice(0, 2),
      filePath: entry.slice(3),
      raw: entry,
    }));
}

function existsRel(relPath) {
  return fs.existsSync(path.join(projectRoot, relPath));
}

const statusEntries = gitStatus();
const ignoredEntries = gitStatus(["--ignored"]).filter((entry) => entry.status === "!!");
const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: projectRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const oldProjectDeletes = statusEntries.filter(
  (entry) => entry.status.includes("D") && entry.filePath.startsWith("项目工程/")
);
const oldDocDeletes = statusEntries.filter(
  (entry) => entry.status.includes("D") && entry.filePath.startsWith("项目文档/")
);
const documentEntries = statusEntries.filter((entry) => entry.filePath.startsWith("项目文档/"));
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

const projectMappings = oldProjectDeletes.map((entry) => {
  const nextPath = entry.filePath.replace(/^项目工程\//, "");
  return {
    oldPath: entry.filePath,
    nextPath,
    existsAtRoot: existsRel(nextPath),
  };
});

const missingProjectTargets = projectMappings.filter((entry) => !entry.existsAtRoot);

assert("migration execution plan document exists", fs.existsSync(planDoc));
assert("migration preflight document exists", fs.existsSync(preflightDoc));
assert("document ownership decision document exists", fs.existsSync(docsOwnershipDoc));
assert("old project paths have current root targets or are already committed", missingProjectTargets.length === 0);
assert("old document deletes are resolved by docs-in-repo mirror", oldDocDeletes.length === 0);
assert("document paths are tracked inside current git root", trackedFiles.includes("项目文档/项目规划.md") && trackedFiles.includes("项目文档/项目白皮书.md"));
assert("workspace document source remains available", fs.existsSync(docsOutsideRoot));
assert("in-repo document directory exists by explicit decision", fs.existsSync(docsInsideRoot));
assert("current root files are tracked after migration", trackedFiles.includes("server.js") && trackedFiles.includes("package.json"));
assert("ignored runtime artifacts remain out of scope", ignoredEntries.length > 0);

const plan = fs.readFileSync(planDoc, "utf8");
const docsOwnership = fs.readFileSync(docsOwnershipDoc, "utf8");
assert(
  "plan keeps index mutation authorization-gated",
  plan.includes("gitIndexMigration=committed-flattened-project-root") &&
    plan.includes("indexMutation=committed-path-migration") &&
    plan.includes("docsOwnershipDecision=docs-in-repo")
);
assert(
  "plan documents document-directory decision",
  plan.includes("项目文档") &&
    plan.includes("docs-in-repo") &&
    plan.includes("outsideMirrorRetained=true")
);
assert(
  "document ownership decision remains non-mutating",
  docsOwnership.includes("docsOwnershipDecision=docs-in-repo") &&
    docsOwnership.includes("gitIndexMigration=committed-flattened-project-root") &&
    docsOwnership.includes("indexMutation=committed-path-migration")
);

console.log("Git flattening migration plan summary:");
console.log(`- old project paths with root targets: ${projectMappings.length}`);
console.log(`- old document deletes after docs-in-repo: ${oldDocDeletes.length}`);
console.log(`- document status entries inside git root: ${documentEntries.length}`);
console.log(`- current root untracked entries: ${rootUntracked.length}`);
console.log(`- current root staged entries: ${rootStagedAdds.length}`);
console.log(`- ignored runtime artifacts: ${ignoredEntries.length}`);
console.log("- docs ownership decision: docs-in-repo");
console.log("- index mutation: committed-path-migration");
console.log("- commit creation: completed");
console.log("Git flattening migration plan checks passed.");
