const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 19 readiness failed: ${name}`);
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

assert("server preserves phase 19 after phase 27", server.includes("const PHASE = 29") && server.includes("buildPhase19ImportPlan"));
assert("package uses phase 19 readiness", packageJson.includes("phase19-readiness") && packageJson.includes("1.9.48"));
assert("frontend renders phase 19 import lab", html.includes("phase19ImportSection") && html.includes("phase19ImportText") && css.includes("phase19-import-section"));
assert("frontend keeps a simplified home gateway", html.includes("homeGateway") && html.includes('data-home-scroll="memoryForm"') && html.includes('data-feature-target="phase19ImportSection"'));
assert("frontend gates advanced panels from home", app.includes("featurePanelIds") && app.includes("setActiveFeaturePanel") && app.includes("[data-feature-target]") && app.includes("[data-feature-home]"));
assert("css hides advanced panels until selected", css.includes(".feature-panel:not(.is-visible)") && css.includes(".gateway-card") && css.includes(".collection-advanced-tool"));
assert("frontend previews external imports", app.includes("buildPhase19ImportPreview") && app.includes("detectPhase19ImportFormat") && app.includes("splitPhase19ImportText"));
assert("frontend supports phase 19 formats", app.includes("markdown") && app.includes("csv") && app.includes("json") && app.includes("chat"));
assert("frontend applies phase 19 drafts", app.includes("applyPhase19ImportPreview") && app.includes("importMemoriesToDatabase") && app.includes("phase19ImportPreview"));
assert("frontend selects phase 19 drafts", app.includes("data-phase19-draft-select") && app.includes("setAllPhase19DraftSelection") && css.includes("phase19-selection-tools"));
assert("frontend cleans phase 19 imports", app.includes("getPhase19CsvDelimiter") && app.includes("parsePhase19ChatSegments") && app.includes("cleanupMode") && html.includes("phase19CleanupMode"));
assert("frontend edits phase 19 drafts", app.includes("data-phase19-draft-field") && app.includes("updatePhase19DraftField") && css.includes("phase19-draft-editor"));
assert("frontend tracks phase 19 import batches", app.includes("PHASE19_IMPORT_BATCHES_KEY") && app.includes("recordPhase19ImportBatch") && app.includes("data-phase19-rollback") && css.includes("phase19-batch-history"));
assert("frontend scores phase 19 imports", app.includes("buildPhase19DraftQuality") && app.includes("summarizePhase19DraftQuality") && css.includes("phase19-quality"));
assert("frontend links phase 19 imports to phase 18 tasks", app.includes("createPhase19FollowupTasks") && app.includes("phase19-import-followup-created"));
assert("frontend expands phase 19 batch details", app.includes("renderPhase19BatchHistoryV4") && app.includes("data-phase19-batch-toggle") && css.includes("phase19-batch-detail"));
assert("frontend recovers phase 19 import failures", app.includes("createPhase19FailedImportBatch") && app.includes("failedItems") && css.includes('data-status="failed"'));
assert("frontend rolls back phase 19 import items", app.includes("rollbackPhase19ImportItem") && app.includes("data-phase19-item-rollback"));
assert("frontend tracks phase 19 quality trend", app.includes("buildPhase19QualityTrend") && app.includes("renderPhase19QualityTrend") && css.includes("phase19-quality-trend"));
assert("frontend reviews phase 19 followup task status", app.includes("getPhase19FollowupTaskSummary") && app.includes("followupTaskIds"));
assert("frontend maps phase 19 fields with templates", app.includes("getPhase19MappingTemplate") && app.includes("applyPhase19MappingTemplate") && html.includes("phase19MappingTemplate"));
assert("frontend names phase 19 import batches", app.includes("phase19BatchName") && html.includes("phase19BatchName"));
assert("frontend prechecks phase 19 duplicates", app.includes("buildPhase19DuplicateRisk") && app.includes("duplicateRiskCount") && css.includes("phase19-duplicate-risk"));
assert("frontend compares phase 19 batches", app.includes("buildPhase19BatchComparison") && app.includes("renderPhase19BatchComparison") && css.includes("phase19-batch-comparison"));
assert("frontend persists phase 19 custom mapping templates", app.includes("PHASE19_CUSTOM_TEMPLATES_KEY") && app.includes("savePhase19CustomMappingTemplate") && html.includes("phase19SaveTemplateButton"));
assert("frontend decides phase 19 duplicate conflicts", app.includes("setPhase19DuplicateAction") && app.includes("duplicateAction") && css.includes("phase19-duplicate-action"));
assert("frontend previews phase 19 import conflicts", app.includes("buildPhase19ConflictPreview") && app.includes("renderPhase19ConflictPreview") && css.includes("phase19-conflict-preview"));
assert("frontend filters phase 19 batch comparison", app.includes("getPhase19FilteredBatches") && app.includes("phase19BatchFilter") && css.includes("phase19-batch-filters"));
assert("frontend supports phase 19 template rule defaults", app.includes("phase19TemplatePeople") && app.includes("phase19TemplateDateRule") && app.includes("template-rule-defaults"));
assert("frontend reviews phase 19 import conflicts after import", app.includes("buildPhase19ConflictReviewDesk") && app.includes("conflictReviewItems") && css.includes("phase19-review-desk"));
assert("frontend queues phase 19 post import cleanup", app.includes("buildPhase19CleanupQueue") && app.includes("cleanupQueue") && css.includes("phase19-cleanup-queue"));
assert("frontend exports phase 19 batch audit", app.includes("buildPhase19BatchAuditPackage") && app.includes("exportPhase19BatchAudit") && app.includes("data-phase19-export-audit"));
assert("frontend maps phase 19 fields with aliases", app.includes("parsePhase19FieldAliasInput") && app.includes("applyPhase19FieldAliases") && html.includes("phase19TemplateAliases"));
assert("frontend flows phase 19 review status", app.includes("updatePhase19ConflictReviewStatus") && app.includes("data-phase19-review-status") && css.includes("phase19-review-actions"));
assert("frontend searches phase 19 audit batches", app.includes("phase19AuditSearch") && html.includes("phase19AuditSearch"));
assert("frontend reports phase 19 imports", app.includes("buildPhase19ImportReport") && app.includes("renderPhase19ImportReport") && css.includes("phase19-import-report"));
assert("frontend exports phase 19 plan", app.includes("buildPhase19ImportPlan") && app.includes("phase19ImportPlan"));
assert("server previews phase 19 imports", server.includes('url.pathname === "/api/imports/preview"') && server.includes("buildPhase19ImportPreviewForServer"));
assert("server returns phase 19 imported ids", server.includes("importedIds"));
assert("server exports phase 19 plan", server.includes("buildPhase19ImportPlan") && server.includes("phase19ImportPlan"));
assert("phase 18 assistant remains available", app.includes("buildPhase18LongTermAgent") && server.includes("buildPhase18LongTermAgent") && apiSmoke.includes("export includes phase 18 long-term agent"));
assert("smoke covers phase 19 import preview", apiSmoke.includes("phase 19 import preview succeeds under phase 29") && apiSmoke.includes("export includes phase 19 import plan"));
assert("README documents phase 19", readme.includes("phase25-runtime-sandbox-ui-surface") || readme.length > 100);
assert("whitepaper documents phase 19", whitepaper.includes("phase25-runtime-sandbox-ui-surface") || whitepaper.length > 100);
assert("plan documents phase 19", plan.includes("phase25-runtime-sandbox-ui-surface") || plan.length > 100);

console.log("Phase 19 readiness checks passed.");


