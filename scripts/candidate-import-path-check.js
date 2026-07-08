const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

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
const html = readText("index.html");
const app = readText("app.js");
const css = readText("styles.css");

assert("candidate import path check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate import path check command",
  packageJson.scripts["candidate:import-path-check"] === "node scripts/candidate-import-path-check.js"
);
assert(
  "check pipeline includes candidate import path check",
  packageJson.scripts.check.includes("node scripts/candidate-import-path-check.js")
);

assert("collection import path guide exists", html.includes('id="collectionImportGuide"'));
assert("phase 19 import boundary guide exists", html.includes('id="phase19ImportBoundary"'));
assert("privacy import boundary guide exists", html.includes('id="privacyImportBoundary"'));
assert("JSON backup selector remains connected to import file input", app.includes('for="importFile"') && html.includes('id="importFile"'));

assert("app builds shared import path guide", app.includes("buildImportPathGuideItems") && app.includes("renderImportPathGuides"));
assert("external material path is preview-first", app.includes("外部资料") && app.includes("先生成导入预览"));
assert("JSON backup path is sync-preview-first", app.includes("JSON 备份") && app.includes("选择 JSON 后生成同步预览"));
assert("SQLite write path stays distinct from database refresh", app.includes("写入 SQLite") && app.includes("同步数据库只是从 SQLite 重新读取"));
assert("guide links ordinary users to phase 19 import and data sync", app.includes('data-feature-target="${escapeHtml(item.target)}"') && app.includes("privacySection") && app.includes("phase19ImportSection"));

assert("styles cover import path guide", css.includes(".import-path-guide") && css.includes(".import-path-grid") && css.includes(".import-path-file-button"));
assert("import guide has responsive layout", css.includes(".import-path-grid { grid-template-columns: repeat(2") && css.includes(".import-path-grid { grid-template-columns: 1fr;"));

assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate import path checks passed.");
