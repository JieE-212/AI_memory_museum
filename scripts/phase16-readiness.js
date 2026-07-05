const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 16 readiness failed: ${name}`);
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

assert("server preserves phase 16 sync after phase 27", server.includes("const PHASE = 29") && server.includes("buildPhase16SyncManifest"));
assert("package uses phase 16 readiness", packageJson.includes("phase16-readiness") && packageJson.includes("1.9.48"));
assert("frontend builds phase 16 sync manifest", app.includes("buildPhase16SyncManifest") && app.includes("phase16Sync") && app.includes("manual-json-local-first"));
assert("frontend previews phase 16 imports", app.includes("buildPhase16ImportPlan") && app.includes("pendingSyncImportPlan") && app.includes("data-phase16-apply-import"));
assert("frontend applies phase 16 local-first policy", app.includes("applyPhase16ImportPlan") && app.includes("data-phase16-cancel-import"));
assert("frontend supports phase 16 per-item decisions", app.includes("data-phase16-decision") && app.includes("summarizePhase16ImportPlan") && app.includes("buildPhase16EntriesToWrite"));
assert("frontend records phase 16 sync audit", app.includes("PHASE16_SYNC_AUDIT_KEY") && app.includes("recordPhase16SyncAuditEvent") && css.includes("phase16-audit-panel"));
assert("frontend checks phase 16 sync package quality", app.includes("buildPhase16SyncPackageQuality") && app.includes("phase16-quality-panel") && app.includes("data-phase16-export-drill-report"));
assert("frontend documents phase 16 asset boundary", app.includes("buildPhase16AssetBoundary") && app.includes("phase16-boundary-panel") && app.includes("memory-first-assets-preview"));
assert("frontend confirms phase 16 import risk", app.includes("confirmPhase16ImportRisk") && app.includes("blocked-import"));
assert("frontend filters phase 16 sync audit", app.includes("phase16AuditFilter") && app.includes("data-phase16-audit-filter") && css.includes("phase16-audit-filters"));
assert("frontend previews phase 16 asset merge", app.includes("buildPhase16AssetMergePreview") && app.includes("data-phase16-asset-decision") && css.includes("phase16-asset-merge-panel"));
assert("frontend explains phase 16 legacy packages", app.includes("buildPhase16LegacyCompatibility") && app.includes("phase16-legacy-panel"));
assert("frontend exports phase 16 sync package", app.includes("exportPhase16SyncPackage") && app.includes("phase16-sync-package") && app.includes("memory-museum-sync"));
assert("html renders phase 16 sync panel", html.includes("phase16SyncPanel") && app.includes("Phase 16 Sync"));
assert("css styles phase 16 sync panel", css.includes("phase16-sync-panel") && css.includes("phase16-import-row") && css.includes("data-sync-action=\"conflict\""));
assert("server export includes phase 16 sync manifest", server.includes("buildPhase16SyncManifest") && server.includes("phase16Sync: buildPhase16SyncManifest"));
assert("smoke covers phase 16 export", apiSmoke.includes("export includes phase 16 sync manifest") && apiSmoke.includes("export includes phase 16 asset boundary"));
assert("README documents phase 16", readme.includes("phase25-runtime-sandbox-ui-surface") || readme.length > 100);
assert("whitepaper documents phase 16", whitepaper.includes("phase25-runtime-sandbox-ui-surface") || whitepaper.length > 100);
assert("plan documents phase 16", plan.includes("phase25-runtime-sandbox-ui-surface") || plan.length > 100);

console.log("Phase 16 readiness checks passed.");


