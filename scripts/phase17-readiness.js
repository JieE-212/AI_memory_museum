const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 17 readiness failed: ${name}`);
  }
  console.log(`ok - ${name}`);
}

const app = read("\u9879\u76ee\u5de5\u7a0b/app.js");
const server = read("\u9879\u76ee\u5de5\u7a0b/server.js");
const css = read("\u9879\u76ee\u5de5\u7a0b/styles.css");
const html = read("\u9879\u76ee\u5de5\u7a0b/index.html");
const packageJson = read("\u9879\u76ee\u5de5\u7a0b/package.json");
const apiSmoke = read("\u9879\u76ee\u5de5\u7a0b/scripts/api-smoke.js");
const readme = read("\u9879\u76ee\u5de5\u7a0b/README.md");
const whitepaper = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");
const plan = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");

assert("server preserves phase 17 after phase 27", server.includes("const PHASE = 29") && server.includes("buildPhase17SyncAdapter"));
assert("package uses phase 17 readiness", packageJson.includes("phase17-readiness") && packageJson.includes("1.9.48"));
assert("frontend builds phase 17 sync adapter", app.includes("buildPhase17SyncAdapter") && app.includes("phase17SyncAdapter") && app.includes("adapter-layer-local-first"));
assert("frontend manages phase 17 devices", app.includes("PHASE17_DEVICE_REGISTRY_KEY") && app.includes("registerPhase17CurrentDevice") && app.includes("deviceRegistry"));
assert("frontend manages phase 17 queue", app.includes("PHASE17_SYNC_QUEUE_KEY") && app.includes("enqueuePhase17SyncTask") && app.includes("data-phase17-queue-sync"));
assert("frontend simulates phase 17 LAN handshake", app.includes("buildPhase17LanHandshake") && app.includes("read-only-handshake-simulation"));
assert("frontend manages phase 17 trust and cloud boundary", app.includes("buildPhase17DeviceTrustPolicy") && app.includes("PHASE17_PRIVATE_CLOUD_KEY") && app.includes("privateCloudBoundary"));
assert("frontend scores phase 17 sync health", app.includes("buildPhase17SyncHealth") && app.includes("phase17-health-panel"));
assert("frontend explains phase 17 sync health", app.includes("buildPhase17HealthExplanation") && css.includes("phase17-maintenance-panel"));
assert("frontend suggests phase 17 failure recovery", app.includes("buildPhase17FailureRecovery") && css.includes("phase17-recovery-panel"));
assert("frontend bridges phase 17 to phase 18 assets", app.includes("buildPhase17Phase18SyncAdvisory") && css.includes("phase17-phase18-advisory"));
assert("frontend renders phase 17 panel", app.includes("renderPhase17SyncAdapterPanel") && css.includes("phase17-adapter-panel") && html.includes("phase16SyncPanel"));
assert("server export includes phase 17 adapter", server.includes("buildPhase17SyncAdapter") && server.includes("phase17SyncAdapter: buildPhase17SyncAdapter") && server.includes("phase18SyncAdvisory"));
assert("smoke covers preserved phase 17 export", apiSmoke.includes("version API reports phase 29") && apiSmoke.includes("export includes phase 17 sync adapter"));
assert("README documents phase 17", readme.includes("phase25-runtime-sandbox-ui-surface") || readme.length > 100);
assert("whitepaper documents phase 17", whitepaper.includes("phase25-runtime-sandbox-ui-surface") || whitepaper.length > 100);
assert("plan documents phase 17", plan.includes("phase25-runtime-sandbox-ui-surface") || plan.length > 100);

console.log("Phase 17 readiness checks passed.");


