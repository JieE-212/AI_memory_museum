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

assert("candidate user path check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate user path check command",
  packageJson.scripts["candidate:user-path-check"] === "node scripts/candidate-user-path-check.js"
);
assert(
  "check pipeline includes candidate user path check",
  packageJson.scripts.check.includes("node scripts/candidate-user-path-check.js")
);

assert("ordinary save readiness status exists", html.includes('id="userPathStatus"') && app.includes("renderUserPathStatus"));
assert("ordinary form keeps essential metadata visible", html.includes("ordinary-form-essential") && html.includes("form-collapse ordinary-form-essential") && html.includes("<summary>"));
assert("ordinary media fields are folded", html.includes("ordinary-form-media") && html.includes('id="coverImageInput"') && html.includes('id="attachmentsInput"'));
assert("ordinary user gateway remains visible", html.includes("user-gateway-grid") && html.includes('data-home-scroll="memoryForm"'));
assert("maintainer gateway remains folded", html.includes('<details class="maintainer-gateway">'));

assert("memory detail uses readable hero", app.includes("dialog-hero") && app.includes("memory-detail-grid") && app.includes("memory-story-block"));
assert("detail view still fetches agent run history", app.includes('id="dialog-agent-run"') && app.includes("fetchAgentRunForMemory"));
assert("styles cover ordinary save readiness", css.includes(".user-path-status") && css.includes('[data-ready="ready"]'));
assert("styles cover folded ordinary form sections", css.includes(".form-collapse") && css.includes(".ordinary-form-media"));
assert("styles cover readable memory detail", css.includes(".dialog-hero") && css.includes(".memory-detail-grid") && css.includes(".memory-story-block"));

assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate ordinary user path checks passed.");
