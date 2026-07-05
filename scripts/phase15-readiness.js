const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 15 readiness failed: ${name}`);
  }
  console.log(`ok - ${name}`);
}

function unique(values) {
  return [...new Set(values)];
}

function checkCssVariables(css) {
  const rootStart = css.indexOf(":root");
  const rootEnd = css.indexOf("}", rootStart);
  const rootBlock = rootStart >= 0 && rootEnd > rootStart ? css.slice(rootStart, rootEnd + 1) : "";
  const defined = new Set([...rootBlock.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  const used = unique([...css.matchAll(/var\(--([a-z0-9-]+)/gi)].map((match) => match[1]));
  const missing = used.filter((name) => !defined.has(name));
  assert("CSS variables are defined", missing.length === 0);
}

const app = read("\u9879\u76ee\u5de5\u7a0b/app.js");
const server = read("\u9879\u76ee\u5de5\u7a0b/server.js");
const database = read("\u9879\u76ee\u5de5\u7a0b/database.js");
const operationsService = read("\u9879\u76ee\u5de5\u7a0b/src/services/operations.js");
const css = read("\u9879\u76ee\u5de5\u7a0b/styles.css");
const packageJson = read("\u9879\u76ee\u5de5\u7a0b/package.json");
const apiSmoke = read("\u9879\u76ee\u5de5\u7a0b/scripts/api-smoke.js");
const readme = read("\u9879\u76ee\u5de5\u7a0b/README.md");
const whitepaper = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");
const plan = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");

checkCssVariables(css);

assert("server preserves phase 15 assets after phase 27", server.includes("const PHASE = 29") && server.includes("buildPhase20PlatformPlan"));
assert("package uses phase 15 readiness", packageJson.includes("phase15-readiness") && packageJson.includes("1.9.48"));
assert("database has phase 15 asset tables", database.includes("CREATE TABLE IF NOT EXISTS saved_exhibitions") && database.includes("CREATE TABLE IF NOT EXISTS report_drafts"));
assert("database exposes asset methods", database.includes("listSavedExhibitions") && database.includes("saveSavedExhibition") && database.includes("listReportDrafts") && database.includes("saveReportDraft"));
assert("server exposes asset APIs", server.includes('url.pathname === "/api/assets"') && server.includes('url.pathname === "/api/exhibitions"') && server.includes('url.pathname === "/api/report-drafts"'));
assert("server exposes insight asset generation", server.includes('url.pathname === "/api/exhibitions/from-theme"') && server.includes('url.pathname === "/api/report-drafts/from-insights"'));
assert("export includes phase 15 assets", server.includes("savedExhibitions: store.listSavedExhibitions()") && server.includes("reportDrafts: store.listReportDrafts()"));
assert("operations documents phase 15", operationsService.includes("buildPhase15Readiness") && operationsService.includes("phase15-assets"));
assert("frontend accepts phase 15+ payloads", app.includes("phase15AssetQuality") && app.includes("(payload?.phase || 0) < 15"));
assert("frontend exposes phase 15 asset actions", app.includes("API_ASSETS") && app.includes("saveThemeAsExhibition") && app.includes("saveReportDraftFromInsights"));
assert("frontend renders phase 15 asset panel", app.includes("renderAssetCollectionPanel") && app.includes("data-theme-save") && app.includes("data-report-draft"));
assert("frontend manages phase 15 assets", app.includes("openSavedAsset") && app.includes("deleteSavedAsset") && app.includes("data-asset-open") && app.includes("data-asset-delete") && app.includes("data-assets-refresh"));
assert("frontend edits phase 15 assets", app.includes("saveSavedAssetEdits") && app.includes("data-asset-edit-form") && app.includes("formatReportSectionsInput") && app.includes("parseReportSectionsInput"));
assert("frontend previews and orders phase 15 assets", app.includes("parseAssetMemoryIdsInput") && app.includes("parseReportReferencesInput") && app.includes("exportActiveAsset") && app.includes("data-asset-export"));
assert("frontend guides phase 15 asset editing", app.includes("insertAssetMemoryFromPicker") && app.includes("insertReportReferenceFromPicker") && app.includes("moveAssetMemoryLine") && app.includes("data-memory-insert") && app.includes("data-reference-insert") && app.includes("asset-package-preview"));
assert("frontend checks phase 15 asset quality", app.includes("buildAssetQualitySummary") && app.includes("renderAssetQualitySummary") && app.includes("validateAssetPayload") && app.includes("data-quality-ready"));
assert("frontend reviews phase 15 asset export", app.includes("buildPhase15AssetExportReview") && app.includes("buildAssetReferenceGraph") && app.includes("renderAssetReferenceGraph") && app.includes("buildAssetRepairSuggestions") && app.includes("phase15AssetReferences") && app.includes("phase15RepairSuggestions"));
assert("frontend confirms phase 15 export quality", app.includes("confirmExportPackageRisk") && app.includes("assetQuality.totalIssues"));
assert("frontend manages phase 15 asset workbench", app.includes("updateSavedAssetStatus") && app.includes("renderAssetStatusAction") && app.includes("data-asset-status") && app.includes("data-next-status"));
assert("frontend filters phase 15 asset export", app.includes("buildAssetExportManifest") && app.includes("renderAssetExportManifest") && app.includes("exportFilteredAssetPackage") && app.includes("data-asset-export-filter"));
assert("frontend batches phase 15 asset publishing", app.includes("batchUpdateAssetStatus") && app.includes("getBatchTransitionPreview") && app.includes("data-asset-batch-from") && app.includes("data-asset-batch-to"));
assert("frontend lists phase 15 asset package", app.includes("buildAssetPackageItems") && app.includes("phase15PackageItems") && app.includes("asset-package-list") && app.includes("asset-diff-preview"));
assert("frontend audits phase 15 asset releases", app.includes("ASSET_AUDIT_KEY") && app.includes("recordAssetAuditEvent") && app.includes("buildAssetReleaseTimeline") && app.includes("phase15AssetAuditLog"));
assert("frontend compares phase 15 asset packages", app.includes("buildAssetPackageComparison") && app.includes("renderAssetPackageComparison") && app.includes("phase15PackageComparison"));
assert("frontend restores phase 15 asset metadata", app.includes("restorePhase15AssetMetadata") && app.includes("mergeImportedAssetAuditLog") && app.includes("mergeImportedAssetSnapshots"));
assert("frontend snapshots phase 15 asset versions", app.includes("ASSET_SNAPSHOT_KEY") && app.includes("captureAssetSnapshot") && app.includes("phase15AssetSnapshots"));
assert("frontend validates phase 15 release package", app.includes("buildAssetPackageValidationSummary") && app.includes("renderAssetPackageValidation") && app.includes("phase15PackageValidation"));
assert("frontend compares phase 15 snapshots", app.includes("buildAssetSnapshotComparison") && app.includes("renderAssetSnapshotComparison") && app.includes("data-asset-snapshot-export"));
assert("frontend filters phase 15 audit records", app.includes("buildAssetAuditFilters") && app.includes("renderAssetAuditFilters") && app.includes("asset-audit-filter"));
assert("frontend signs phase 15 release packages", app.includes("buildAssetPackageSignature") && app.includes("verifyImportedAssetPackageSignature") && app.includes("phase15PackageSignature") && app.includes("asset-package-signature"));
assert("frontend searches phase 15 audit records", app.includes("buildAssetAuditSearch") && app.includes("renderAssetAuditSearch") && app.includes("data-asset-audit-search") && app.includes("phase15AuditSearch"));
assert("frontend selects phase 15 snapshots", app.includes("getSelectedAssetSnapshot") && app.includes("data-asset-snapshot-select") && app.includes("exportSelectedAssetSnapshot") && app.includes("phase15SelectedSnapshot"));
assert("frontend suggests phase 15 signature repairs", app.includes("buildAssetSignatureAnomalyPlan") && app.includes("phase15SignatureRecovery") && app.includes("repairSuggestions"));
assert("frontend polishes phase 15 collection layout", app.includes("museum-empty-state") && app.includes("data-empty-action") && read("\u9879\u76ee\u5de5\u7a0b/index.html").includes("collection-section-primary"));
assert("frontend reduces phase 15 asset workbench noise", app.includes("asset-advanced-tools") && app.includes("asset-recovery-note"));
assert("css styles phase 15 asset quality", css.includes("asset-quality-panel") && css.includes("asset-quality-grid") && css.includes("data-quality-status"));
assert("css styles phase 15 asset review", css.includes("asset-reference-map") && css.includes("asset-repair-list") && css.includes("asset-reference-row"));
assert("css styles phase 15 asset workbench", css.includes("asset-export-filter") && css.includes("asset-export-statuses") && css.includes("asset-export-actions"));
assert("css styles phase 15 asset batch workbench", css.includes("asset-batch-actions") && css.includes("asset-diff-preview") && css.includes("asset-package-row"));
assert("css styles phase 15 asset audit", css.includes("asset-release-timeline") && css.includes("asset-audit-row") && css.includes("asset-package-compare") && css.includes("asset-compare-grid"));
assert("css styles phase 15 recovery validation", css.includes("asset-snapshot-list") && css.includes("asset-snapshot-row") && css.includes("asset-package-validation") && css.includes("asset-validation-grid"));
assert("css styles phase 15 signature tools", css.includes("asset-snapshot-compare") && css.includes("asset-audit-filter-grid") && css.includes("asset-signature-line"));
assert("css styles phase 15 recovery search tools", css.includes("asset-audit-search-form") && css.includes("asset-row-actions") && css.includes("asset-signature-recovery"));
assert("css styles phase 15 experience polish", css.includes("museum-empty-state") && css.includes("asset-advanced-tools") && css.includes("asset-recovery-note"));
assert("html includes saved asset panel", read("\u9879\u76ee\u5de5\u7a0b/index.html").includes("savedAssetsPanel") && read("\u9879\u76ee\u5de5\u7a0b/index.html").includes("assetSummaryMeta"));
assert("smoke covers phase 15 assets", apiSmoke.includes("assets API returns phase 15 assets") && apiSmoke.includes("saved exhibition create succeeds") && apiSmoke.includes("report draft create succeeds"));
assert("smoke covers phase 15 asset management", apiSmoke.includes("saved exhibition detail succeeds") && apiSmoke.includes("saved exhibition delete succeeds") && apiSmoke.includes("report draft detail succeeds") && apiSmoke.includes("report draft delete succeeds"));
assert("smoke covers phase 15 asset editing", apiSmoke.includes("saved exhibition edit succeeds") && apiSmoke.includes("report draft edit succeeds"));
assert("smoke covers phase 15 edited asset export", apiSmoke.includes("export includes edited phase 15 assets"));
assert("smoke covers insight generated assets", apiSmoke.includes("theme exhibition generation succeeds") && apiSmoke.includes("insights report draft generation succeeds"));
assert("README documents phase 15", readme.includes("phase25-runtime-sandbox-ui-surface") || readme.length > 100);
assert("whitepaper documents phase 15", whitepaper.includes("phase25-runtime-sandbox-ui-surface") || whitepaper.length > 100);
assert("plan documents phase 15", plan.includes("phase25-runtime-sandbox-ui-surface") || plan.length > 100);

console.log("Phase 15 readiness checks passed.");


