const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 14 readiness failed: ${name}`);
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

const app = read("项目工程/app.js");
const server = read("项目工程/server.js");
const operationsService = read("项目工程/src/services/operations.js");
const healthRoutes = read("项目工程/src/routes/health.js");
const operationsRoutes = read("项目工程/src/routes/operations.js");
const css = read("项目工程/styles.css");
const html = read("项目工程/index.html");
const readme = read("项目工程/README.md");
const packageJson = read("项目工程/package.json");
const apiSmoke = read("项目工程/scripts/api-smoke.js");
const whitepaper = read("项目文档/项目白皮书.md");
const plan = read("项目文档/项目规划.md");

checkCssVariables(css);

assert("server reports phase 14", server.includes("const PHASE = 14") && server.includes("工程模块化和服务边界重构版"));
assert("operations service module exists", operationsService.includes("createOperationsService") && operationsService.includes("buildVersionInfo") && operationsService.includes("buildOperationsSummary"));
assert("server uses operations service", server.includes('require("./src/services/operations")') && server.includes("createOperationsService"));
assert("health route module exists", healthRoutes.includes("createHealthRoutes") && healthRoutes.includes("handleHealthRoute"));
assert("server uses health routes", server.includes('require("./src/routes/health")') && server.includes("healthRoutes.handleHealthRoute"));
assert("operations route module exists", operationsRoutes.includes("createOperationsRoutes") && operationsRoutes.includes("handleOperationsRoute"));
assert("server uses operations routes", server.includes('require("./src/routes/operations")') && server.includes("operationsRoutes.handleOperationsRoute"));
assert("operations export remains", operationsRoutes.includes('url.pathname === "/api/operations/export"') && operationsService.includes("buildOperationsExport"));
assert("phase 14 readiness exists", operationsService.includes("buildPhase14Readiness") && operationsService.includes("buildModuleBoundaryPlan"));
assert("phase 15 readiness exists", operationsService.includes("buildPhase15Readiness") && operationsService.includes("buildPhase15AssetPlan"));
assert("frontend expects phase 14", app.includes("phase: 14") && app.includes("payload?.phase !== 14") && app.includes("phase14Panel"));
assert("frontend exposes phase 15 prep", app.includes("phase15Panel") && app.includes("buildLocalPhase15Readiness") && app.includes("renderPhase15AssetPlan"));
assert("phase 14 smoke coverage exists", apiSmoke.includes("health reports phase 14") && apiSmoke.includes("operations API reports phase 14") && apiSmoke.includes("operations export includes phase 15 readiness"));
assert("package uses phase 14 readiness", packageJson.includes("phase14-readiness") && packageJson.includes("src/services/operations.js") && packageJson.includes("src/routes/health.js") && packageJson.includes("src/routes/operations.js"));
assert("README documents phase 14", readme.includes("第十四阶段") && readme.includes("health route") && readme.includes("阶段 15"));
assert("whitepaper documents phase 14", whitepaper.includes("第十四阶段") && whitepaper.includes("工程模块化"));
assert("plan documents phase 14", plan.includes("当前阶段：阶段 14") && plan.includes("health route") && plan.includes("可以进入阶段 15"));

console.log("Phase 14 readiness checks passed.");
