const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const docsOutsideRoot = path.join(workspaceRoot, "项目文档");
const docsInsideRoot = path.join(projectRoot, "项目文档");
const decisionDoc = path.join(docsOutsideRoot, "文档归属决策记录.md");

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

function listMarkdownFiles(root) {
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

assert("outside document directory exists", fs.existsSync(docsOutsideRoot));
assert("inside document directory exists", fs.existsSync(docsInsideRoot));
assert("document ownership decision exists", fs.existsSync(decisionDoc));

const decision = fs.readFileSync(decisionDoc, "utf8");
assert(
  "document ownership is accepted in repo",
  decision.includes("docsOwnershipDecision=docs-in-repo") &&
    decision.includes("outsideMirrorRetained=true") &&
    decision.includes("indexMutation=committed-path-migration")
);

const outsideFiles = listMarkdownFiles(docsOutsideRoot);
const insideFiles = listMarkdownFiles(docsInsideRoot);

assert("inside document mirror has every outside markdown file", outsideFiles.every((name) => insideFiles.includes(name)));

const mismatched = outsideFiles.filter((name) => {
  const outsideHash = hashFile(path.join(docsOutsideRoot, name));
  const insideHash = hashFile(path.join(docsInsideRoot, name));
  return outsideHash !== insideHash;
});

assert("inside document mirror matches outside source", mismatched.length === 0);

console.log("Document ownership check summary:");
console.log(`- ownership: docs-in-repo`);
console.log(`- mirrored markdown files: ${outsideFiles.length}`);
console.log("- outside mirror retained: true");
console.log("- index mutation: committed-path-migration");
console.log("Document ownership checks passed.");
