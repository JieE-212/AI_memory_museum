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

const app = read("项目工程/app.js");
const server = read("项目工程/server.js");
const css = read("项目工程/styles.css");
const html = read("项目工程/index.html");
const packageJson = read("项目工程/package.json");
const apiSmoke = read("项目工程/scripts/api-smoke.js");
const readme = read("项目工程/README.md");
const whitepaper = read("项目文档/项目白皮书.md");
const plan = read("项目文档/项目规划.md");

assert("server preserves phase 17 after phase 20", server.includes("const PHASE = 20") && server.includes("buildPhase17SyncAdapter"));
assert("package uses phase 17 readiness", packageJson.includes("phase17-readiness") && packageJson.includes("1.0.10"));
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
assert("smoke covers preserved phase 17 export", apiSmoke.includes("version API reports phase 20") && apiSmoke.includes("export includes phase 17 sync adapter"));
assert("README documents phase 17", readme.includes("第十七阶段") && readme.includes("真实多设备同步适配层"));
assert("whitepaper documents phase 17", whitepaper.includes("第十七阶段") && whitepaper.includes("多设备同步适配层"));
assert("plan documents phase 17", plan.includes("阶段 17") && plan.includes("phase17-sync-health-sixth-edition"));

console.log("Phase 17 readiness checks passed.");

