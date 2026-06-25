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

const app = read("项目工程/app.js");
const server = read("项目工程/server.js");
const css = read("项目工程/styles.css");
const html = read("项目工程/index.html");
const packageJson = read("项目工程/package.json");
const apiSmoke = read("项目工程/scripts/api-smoke.js");
const readme = read("项目工程/README.md");
const whitepaper = read("项目文档/项目白皮书.md");
const plan = read("项目文档/项目规划.md");

assert("server preserves phase 16 sync after phase 20", server.includes("const PHASE = 20") && server.includes("buildPhase16SyncManifest"));
assert("package uses phase 16 readiness", packageJson.includes("phase16-readiness") && packageJson.includes("1.0.10"));
assert("frontend builds phase 16 sync manifest", app.includes("buildPhase16SyncManifest") && app.includes("phase16Sync") && app.includes("manual-json-local-first"));
assert("frontend previews phase 16 imports", app.includes("buildPhase16ImportPlan") && app.includes("pendingSyncImportPlan") && app.includes("data-phase16-apply-import"));
assert("frontend applies phase 16 local-first policy", app.includes("applyPhase16ImportPlan") && app.includes("复制为新展品") && app.includes("保留本地") && app.includes("data-phase16-cancel-import"));
assert("frontend supports phase 16 per-item decisions", app.includes("data-phase16-decision") && app.includes("summarizePhase16ImportPlan") && app.includes("buildPhase16EntriesToWrite"));
assert("frontend records phase 16 sync audit", app.includes("PHASE16_SYNC_AUDIT_KEY") && app.includes("recordPhase16SyncAuditEvent") && css.includes("phase16-audit-panel"));
assert("frontend checks phase 16 sync package quality", app.includes("buildPhase16SyncPackageQuality") && app.includes("phase16-quality-panel") && app.includes("data-phase16-export-drill-report"));
assert("frontend documents phase 16 asset boundary", app.includes("buildPhase16AssetBoundary") && app.includes("phase16-boundary-panel") && app.includes("memory-first-assets-preview"));
assert("frontend confirms phase 16 import risk", app.includes("confirmPhase16ImportRisk") && app.includes("blocked-import") && app.includes("同步包被阻止导入"));
assert("frontend filters phase 16 sync audit", app.includes("phase16AuditFilter") && app.includes("data-phase16-audit-filter") && css.includes("phase16-audit-filters"));
assert("frontend previews phase 16 asset merge", app.includes("buildPhase16AssetMergePreview") && app.includes("data-phase16-asset-decision") && css.includes("phase16-asset-merge-panel"));
assert("frontend explains phase 16 legacy packages", app.includes("buildPhase16LegacyCompatibility") && app.includes("phase16-legacy-panel") && app.includes("旧备份兼容模式"));
assert("frontend exports phase 16 sync package", app.includes("exportPhase16SyncPackage") && app.includes("phase16-sync-package") && app.includes("memory-museum-sync"));
assert("html renders phase 16 sync panel", html.includes("phase16SyncPanel") && app.includes("Phase 16 Sync"));
assert("css styles phase 16 sync panel", css.includes("phase16-sync-panel") && css.includes("phase16-import-row") && css.includes("data-sync-action=\"conflict\""));
assert("server export includes phase 16 sync manifest", server.includes("buildPhase16SyncManifest") && server.includes("phase16Sync: buildPhase16SyncManifest"));
assert("smoke covers phase 16 export", apiSmoke.includes("export includes phase 16 sync manifest") && apiSmoke.includes("export includes phase 16 asset boundary"));
assert("README documents phase 16", readme.includes("第十六阶段") && readme.includes("逐项冲突决策") && readme.includes("同步审计"));
assert("whitepaper documents phase 16", whitepaper.includes("第十六阶段") && whitepaper.includes("多端同步"));
assert("plan documents phase 16", plan.includes("阶段 16") && plan.includes("phase16-asset-merge-fifth-edition"));

console.log("Phase 16 readiness checks passed.");

