const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 18 readiness failed: ${name}`);
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

assert("server preserves phase 18 after phase 19", server.includes("const PHASE = 19") && server.includes("buildPhase18LongTermAgent"));
assert("package uses phase 18 readiness", packageJson.includes("phase18-readiness") && packageJson.includes("0.9.8"));
assert("frontend builds phase 18 long-term agent", app.includes("buildPhase18LongTermAgent") && app.includes("phase18LongTermAgent") && app.includes("local-long-term-memory-assistant"));
assert("frontend renders phase 18 panel", app.includes("renderPhase18AgentPanel") && html.includes("phase18AgentPanel") && css.includes("phase18-agent-panel"));
assert("frontend supports phase 18 suggestions and relationships", app.includes("buildPhase18ProactiveSuggestions") && app.includes("buildPhase18RelationshipMap") && app.includes("buildPhase18PeriodicReviews"));
assert("frontend records phase 18 feedback", app.includes("PHASE18_AGENT_FEEDBACK_KEY") && app.includes("recordPhase18AgentFeedback") && app.includes("data-phase18-feedback"));
assert("frontend manages phase 18 repair drafts", app.includes("PHASE18_REPAIR_DRAFT_KEY") && app.includes("queuePhase18RepairDrafts") && app.includes("data-phase18-apply-repair"));
assert("frontend persists phase 18 task queue", app.includes("PHASE18_TASK_QUEUE_KEY") && app.includes("syncPhase18TaskQueue") && app.includes("data-phase18-task-status"));
assert("frontend batches phase 18 tasks", app.includes("buildPhase18TaskBatchReview") && app.includes("data-phase18-task-select") && app.includes("data-phase18-task-batch-status") && app.includes("data-phase18-task-batch-repair") && css.includes("phase18-task-batch-panel"));
assert("frontend audits phase 18 task work", app.includes("PHASE18_TASK_AUDIT_KEY") && app.includes("recordPhase18TaskAudit") && css.includes("phase18-audit-panel"));
assert("frontend batches phase 18 repair review", app.includes("buildPhase18RepairBatchReview") && app.includes("applyPhase18RepairDraftBatch") && app.includes("data-phase18-apply-repair-batch"));
assert("frontend saves phase 18 review assets", app.includes("savePhase18PeriodicReviewAsset") && app.includes("data-phase18-save-review") && app.includes("periodicAssetPlan"));
assert("frontend saves phase 18 review reports", app.includes("savePhase18PeriodicReviewReport") && app.includes("data-phase18-save-review-report") && app.includes("periodicReportPlan"));
assert("frontend links phase 18 assets to sync state", app.includes("buildPhase18AssetSyncState") && app.includes("assetSyncState") && app.includes("phase18-asset-sync-state") && css.includes("phase18-asset-sync-state"));
assert("frontend measures phase 18 quality", app.includes("buildPhase18AgentQuality") && css.includes("phase18-quality-strip"));
assert("frontend tiers phase 18 suggestions", app.includes("buildPhase18SuggestionQuality") && app.includes("suggestionQuality") && app.includes("级建议"));
assert("frontend renders phase 18 relationship graph", app.includes("buildPhase18RelationshipGraph") && css.includes("phase18-graph"));
assert("frontend links phase 18 graph to assets", app.includes("buildPhase18AssetNavigationIndex") && app.includes("assetNavigation") && app.includes("data-phase18-open-asset") && app.includes("data-node-type=\"${escapeHtml(node.type)}\"") && css.includes("phase18-relation-assets"));
assert("frontend reviews phase 18 assistant work", app.includes("buildPhase18ReviewDashboard") && css.includes("phase18-review-dashboard"));
assert("frontend reduces phase 18 suggestion noise", app.includes("buildPhase18SuggestionNoisePolicy") && app.includes("visibleSuggestions"));
assert("frontend configures phase 18 noise rules", app.includes("PHASE18_NOISE_RULE_KEY") && app.includes("loadPhase18NoiseRuleConfig") && app.includes("data-phase18-noise-toggle") && css.includes("phase18-noise-rule-panel"));
assert("frontend previews phase 18 noise rules", app.includes("buildPhase18NoiseRulePreview") && app.includes("recoverableCount") && app.includes("data-phase18-noise-score"));
assert("frontend filters phase 18 graph", app.includes("phase18GraphFilter") && app.includes("data-phase18-graph-filter"));
assert("frontend opens phase 18 generated assets", app.includes("data-phase18-open-asset") && app.includes("data-phase18-open-report"));
assert("frontend creates phase 18 review tasks", app.includes("createPhase18ReviewDashboardTask") && app.includes("data-phase18-create-review-task"));
assert("frontend creates phase 18 digest tasks", app.includes("buildPhase18AgentDigest") && app.includes("agentDigest") && app.includes("createPhase18DigestTask") && app.includes("data-phase18-create-digest-task") && css.includes("phase18-agent-digest"));
assert("frontend opens phase 18 graph memories", app.includes("data-node-type") && app.includes("data-phase18-open"));
assert("frontend explains phase 18 relationship evidence", app.includes("strength:") && app.includes("evidence:") && app.includes("证据"));
assert("server export includes phase 18 agent", server.includes("buildPhase18LongTermAgent") && server.includes("phase18LongTermAgent: buildPhase18LongTermAgent") && server.includes("buildPhase18NoiseRulePreview") && server.includes("configurable-tier-feedback") && server.includes("buildPhase18TaskBatchPlan") && server.includes("buildPhase18AssetSyncStateForServer") && server.includes("buildPhase18AssetNavigationIndexForServer") && server.includes("buildPhase18AgentDigestForServer") && server.includes("agentDigest"));
assert("smoke covers phase 18 version and export", apiSmoke.includes("version API reports phase 19") && apiSmoke.includes("export includes phase 18 long-term agent"));
assert("README documents phase 18", readme.includes("第十八阶段") && readme.includes("长期记忆助理"));
assert("whitepaper documents phase 18", whitepaper.includes("第十八阶段") && whitepaper.includes("长期记忆助理"));
assert("plan documents phase 18", plan.includes("阶段 18") && plan.includes("phase18-agent-digest-thirteenth-edition"));

console.log("Phase 18 readiness checks passed.");
