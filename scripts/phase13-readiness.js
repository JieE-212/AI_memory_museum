const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 13 readiness failed: ${name}`);
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
const operationsService = read("\u9879\u76ee\u5de5\u7a0b/src/services/operations.js");
const healthRoutes = read("\u9879\u76ee\u5de5\u7a0b/src/routes/health.js");
const operationsRoutes = read("\u9879\u76ee\u5de5\u7a0b/src/routes/operations.js");
const css = read("\u9879\u76ee\u5de5\u7a0b/styles.css");
const html = read("\u9879\u76ee\u5de5\u7a0b/index.html");
const readme = read("\u9879\u76ee\u5de5\u7a0b/README.md");
const packageJson = read("\u9879\u76ee\u5de5\u7a0b/package.json");
const apiSmoke = read("\u9879\u76ee\u5de5\u7a0b/scripts/api-smoke.js");
const whitepaper = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");
const plan = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");

checkCssVariables(css);

assert("phase 13 is historically recorded", operationsService.includes("phase13-phase14-readiness-edition") && app.includes("phase13-phase14-readiness-edition"));
assert("current server has advanced beyond phase 14", server.includes("const PHASE = 15") && server.includes("专题资产、报告编辑和可保存展览版"));
assert("version API exists", operationsRoutes.includes('url.pathname === "/api/version"') && operationsRoutes.includes("operationsService.buildVersionInfo") && apiSmoke.includes("version API reports phase 15"));
assert("operations summary exists", healthRoutes.includes("operationsService.buildOperationsSummary") && server.includes('require("./src/services/operations")') && server.includes('require("./src/routes/operations")'));
assert("health exposes operations", healthRoutes.includes("operationsService.buildOperationsSummary") && server.includes('require("./src/routes/health")') && apiSmoke.includes("health exposes operations summary"));
assert("frontend renders operations panel", html.includes("operationsSection") && html.includes("operationsSummaryGrid") && app.includes("renderOperationsPanel") && css.includes(".operations-section"));
assert("frontend syncs version info", app.includes("API_VERSION") && app.includes("syncVersionInfo") && app.includes("operationsSource"));
assert("phase 13 phase 14 readiness edition exists", server.includes("buildPhase14Readiness") && server.includes("buildModuleBoundaryPlan") && app.includes("phase14Panel") && html.includes("moduleBoundaryPanel"));
assert("phase 13 phase 14 readiness smoke coverage exists", apiSmoke.includes("phase 14 readiness") && apiSmoke.includes("operations API exposes phase 14 plan") && apiSmoke.includes("operations export includes phase 14 readiness"));
assert("phase 13 release records exist", operationsService.includes("buildReleaseHistory") && app.includes("buildLocalReleaseHistory") && operationsService.includes("phase13-phase14-readiness-edition"));
assert("deployment checks are documented in app", app.includes("npm.cmd run check") && app.includes("npm.cmd run smoke") && server.includes("nextEngineeringSteps"));
assert("phase 12 data sovereignty remains", server.includes('url.pathname === "/api/privacy"') && app.includes("renderPrivacyPanel") && apiSmoke.includes("privacy API reports phase 15"));
assert("redacted export remains", server.includes("buildRedactedMemory") && app.includes("exportRedactedMemories") && apiSmoke.includes("redacted export succeeds"));
assert("phase 11 orchestration remains", server.includes('url.pathname === "/api/workflows"') && app.includes("renderWorkflowOrchestration"));
assert("package uses current readiness", packageJson.includes("phase15-readiness") && packageJson.includes("scripts/api-smoke.js"));
assert("README documents phase 13", readme.includes("第十三阶段") && readme.includes("/api/version") && readme.includes("部署与运维"));
assert("whitepaper documents phase 13", whitepaper.includes("第十三阶段") && whitepaper.includes("部署"));
assert("plan documents phase 13", plan.includes("阶段 13") && plan.includes("产品化、部署和运维"));

console.log("Phase 13 historical readiness checks passed under the current Phase 15 baseline.");

