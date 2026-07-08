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
const readme = readText("README.md");
const acceptanceGuide = readText(path.join("项目文档", "当前候选交付验收说明.md"));

assert("candidate UI check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate delivery UI check command",
  packageJson.scripts["candidate:delivery-ui-check"] === "node scripts/candidate-delivery-ui-check.js"
);
assert(
  "check pipeline includes candidate delivery UI check",
  packageJson.scripts.check.includes("node scripts/candidate-delivery-ui-check.js")
);

assert("maintainer gateway is folded by default", html.includes('<details class="maintainer-gateway">'));
assert("maintainer gateway label is present", html.includes("维护者入口"));
assert("ordinary user gateway remains visible", html.includes("user-gateway-grid") && html.includes('data-home-scroll="memoryForm"') && html.includes('data-home-scroll="guidePanel"'));
assert("maintainer gate status container exists", html.includes('id="maintainerGateStatus"'));
assert("candidate delivery overview container exists", html.includes('id="candidateDeliveryOverview"'));
assert("collection sync notice container exists", html.includes('id="collectionSyncNotice"'));
assert("SQLite write button uses current label", html.includes('id="migrateLocalButton">写入 SQLite</button>'));
assert("old migration button label is absent", !html.includes('id="migrateLocalButton">迁移本地</button>'));
assert("old migration callout copy is absent", !app.includes("可点击“迁移本地”"));

assert("app tracks browser demo collection state", app.includes("DEMO_COLLECTION_KEY") && app.includes("isLocalDemoCollection") && app.includes("renderCollectionSyncNotice"));
assert("app renders maintainer gate status", app.includes("buildMaintainerGateStatus") && app.includes("renderMaintainerGateStatus") && app.includes("治理红线"));
assert("app renders candidate delivery overview", app.includes("buildCandidateDeliveryOverview") && app.includes("renderCandidateDeliveryOverview") && app.includes("当前候选交付：可体验、可复核、不可发布"));
assert("candidate overview includes verification commands", app.includes("npm.cmd run check") && app.includes("npm.cmd run phase30:evidence-closure-status"));
assert("candidate overview preserves live submission guardrail", app.includes("data/phase30-human-evidence-submission.json") && app.includes("真实 reviewer 证据"));

assert("styles cover maintainer gate status", css.includes(".maintainer-gate-status") && css.includes(".maintainer-gate-grid"));
assert("styles cover candidate delivery overview", css.includes(".candidate-delivery-overview") && css.includes(".candidate-delivery-grid") && css.includes(".candidate-command-strip"));
assert("styles cover collection sync notice", css.includes(".collection-sync-notice") && css.includes("[data-needs-migration] #migrateLocalButton"));

assert("acceptance guide exists and names candidate state", acceptanceGuide.includes("# 当前候选交付验收说明") && acceptanceGuide.includes("rc-reviewable-but-not-releasable"));
assert("acceptance guide documents SQLite boundary", acceptanceGuide.includes("SQLite 空库") && acceptanceGuide.includes("写入 SQLite") && acceptanceGuide.includes("浏览器示例"));
assert("acceptance guide documents maintainer overview", acceptanceGuide.includes("维护者入口") && acceptanceGuide.includes("治理红线") && acceptanceGuide.includes("当前候选交付"));
assert("acceptance guide documents required checks", acceptanceGuide.includes("npm.cmd run check") && acceptanceGuide.includes("npm.cmd run phase30:evidence-closure-status"));
assert("acceptance guide keeps release and runtime blocked", acceptanceGuide.includes("releaseReady=false") && acceptanceGuide.includes("runtimeExecution=false") && acceptanceGuide.includes("thirdPartyExecution=false"));
assert("README links candidate acceptance guide", readme.includes("Current candidate delivery acceptance guide") && readme.includes("项目文档/当前候选交付验收说明.md"));

assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate delivery UI checks passed.");
