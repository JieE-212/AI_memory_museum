const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 20 readiness failed: ${name}`);
  }
  console.log(`ok - ${name}`);
}

const app = read("\u9879\u76ee\u5de5\u7a0b/app.js");
const server = read("\u9879\u76ee\u5de5\u7a0b/server.js");
const operations = read("\u9879\u76ee\u5de5\u7a0b/src/services/operations.js");
const css = read("\u9879\u76ee\u5de5\u7a0b/styles.css");
const html = read("\u9879\u76ee\u5de5\u7a0b/index.html");
const packageJson = read("\u9879\u76ee\u5de5\u7a0b/package.json");
const apiSmoke = read("\u9879\u76ee\u5de5\u7a0b/scripts/api-smoke.js");
const readme = read("\u9879\u76ee\u5de5\u7a0b/README.md");
const whitepaper = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");
const plan = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");

assert("server reports phase 20", server.includes("const PHASE = 20") && server.includes("PHASE_NAME"));
assert("package uses phase 20 readiness", packageJson.includes("phase20-readiness") && packageJson.includes("1.0.10"));
assert("server exports phase 20 platform plan", server.includes("buildPhase20PlatformPlan") && server.includes("phase20PlatformPlan") && server.includes("manifest-only-no-third-party-code-execution"));
assert("server exports phase 20 manifest schema", server.includes("phase20.plugin.manifest.v1") && server.includes("manifestSchema") && server.includes("manifestValidation"));
assert("server exports phase 20 permission review", server.includes("permissionReview") && server.includes("deny-until-reviewed") && server.includes("auditEventTypes"));
assert("server exports phase 20 plugin audit log", server.includes("pluginAuditLog") && server.includes("phase20.plugin.audit.v1") && server.includes("runtime-blocked"));
assert("server exports phase 20 built-in registry", server.includes("builtInPluginRegistry") && server.includes("phase20.builtIn.registry.v1") && server.includes("registryChecks"));
assert("server exports phase 20 extension contract tests", server.includes("extensionContractTests") && server.includes("phase20.extension.contract-tests.v1") && server.includes("block-plugin-and-record-audit-event"));
assert("server exports phase 20 sandbox boundary", server.includes("sandboxBoundary") && server.includes("phase20.plugin.sandbox-boundary.v1") && server.includes("direct-database-access"));
assert("server exports phase 20 no-code template pack", server.includes("noCodeTemplatePack") && server.includes("phase20.no-code.template-pack.v1") && server.includes("exhibition-layout-template"));
assert("server exports phase 20 signed manifest policy", server.includes("signedManifestPolicy") && server.includes("phase20.signed.manifest-policy.v1") && server.includes("blocked-unsigned"));
assert("server exports phase 20 plugin installation workflow", server.includes("pluginInstallationWorkflow") && server.includes("phase20.plugin.installation-workflow.v1") && server.includes("signature-missing-or-mismatch"));
assert("server exports phase 20 template preview fixtures", server.includes("templatePreviewFixtures") && server.includes("phase20.template.preview-fixtures.v1") && server.includes("negative-fixture-not-blocked"));
assert("operations service exposes phase 20 platform plan", operations.includes("buildPhase20PlatformPlan") && operations.includes("phase20PlatformPlan") && operations.includes("phase20-readiness"));
assert("operations service exposes phase 20 manifest schema", operations.includes("phase20.plugin.manifest.v1") && operations.includes("manifestSchema") && operations.includes("manifestValidation"));
assert("operations service exposes phase 20 permission review", operations.includes("permissionReview") && operations.includes("deny-until-reviewed") && operations.includes("auditEventTypes"));
assert("operations service exposes phase 20 plugin audit log", operations.includes("pluginAuditLog") && operations.includes("phase20.plugin.audit.v1") && operations.includes("runtime-blocked"));
assert("operations service exposes phase 20 built-in registry", operations.includes("builtInPluginRegistry") && operations.includes("phase20.builtIn.registry.v1") && operations.includes("registryChecks"));
assert("operations service exposes phase 20 extension contract tests", operations.includes("extensionContractTests") && operations.includes("phase20.extension.contract-tests.v1") && operations.includes("asset-template-contract"));
assert("operations service exposes phase 20 sandbox boundary", operations.includes("sandboxBoundary") && operations.includes("phase20.plugin.sandbox-boundary.v1") && operations.includes("sandbox-enforcer-implemented"));
assert("operations service exposes phase 20 no-code template pack", operations.includes("noCodeTemplatePack") && operations.includes("phase20.no-code.template-pack.v1") && operations.includes("sync-preview-template"));
assert("operations service exposes phase 20 signed manifest policy", operations.includes("signedManifestPolicy") && operations.includes("phase20.signed.manifest-policy.v1") && operations.includes("manifest-mutated-after-review"));
assert("operations service exposes phase 20 plugin installation workflow", operations.includes("pluginInstallationWorkflow") && operations.includes("phase20.plugin.installation-workflow.v1") && operations.includes("sandbox-boundary-violation"));
assert("operations service exposes phase 20 template preview fixtures", operations.includes("templatePreviewFixtures") && operations.includes("phase20.template.preview-fixtures.v1") && operations.includes("template-preview-blocked"));
assert("frontend renders phase 20 platform panel", html.includes("phase20PlatformSection") && html.includes("phase20ExtensionPanel") && html.includes("phase20PluginPanel") && html.includes("phase20RegistryPanel") && html.includes("phase20ManifestPanel") && html.includes("phase20PermissionPanel") && html.includes("phase20AuditPanel") && html.includes("phase20ContractPanel") && html.includes("phase20SandboxPanel") && html.includes("phase20TemplatePanel") && html.includes("phase20FixturePanel") && html.includes("phase20SignaturePanel") && html.includes("phase20InstallPanel"));
assert("frontend opens phase 20 from home gateway", html.includes('data-feature-target="phase20PlatformSection"') && app.includes("phase20PlatformSection") && app.includes("renderPhase20PlatformPanel"));
assert("frontend has local phase 20 fallback", app.includes("buildLocalPhase20PlatformPlan") && app.includes("plugin-manifest-registry") && app.includes("thirdPartyExecution"));
assert("frontend renders phase 20 manifest schema", app.includes("phase20ManifestPanel") && app.includes("manifestSchema") && app.includes("phase20.plugin.manifest.v1"));
assert("frontend renders phase 20 permission review", app.includes("phase20PermissionPanel") && app.includes("permissionReview") && app.includes("deny-until-reviewed"));
assert("frontend renders phase 20 plugin audit log", app.includes("phase20AuditPanel") && app.includes("pluginAuditLog") && app.includes("phase20.plugin.audit.v1"));
assert("frontend renders phase 20 built-in registry", app.includes("phase20RegistryPanel") && app.includes("builtInPluginRegistry") && app.includes("phase20.builtIn.registry.v1"));
assert("frontend renders phase 20 extension contract tests", app.includes("phase20ContractPanel") && app.includes("extensionContractTests") && app.includes("phase20.extension.contract-tests.v1"));
assert("frontend renders phase 20 sandbox boundary", app.includes("phase20SandboxPanel") && app.includes("sandboxBoundary") && app.includes("phase20.plugin.sandbox-boundary.v1"));
assert("frontend renders phase 20 no-code template pack", app.includes("phase20TemplatePanel") && app.includes("noCodeTemplatePack") && app.includes("phase20.no-code.template-pack.v1"));
assert("frontend renders phase 20 template preview fixtures", app.includes("phase20FixturePanel") && app.includes("templatePreviewFixtures") && app.includes("phase20.template.preview-fixtures.v1"));
assert("frontend renders phase 20 signed manifest policy", app.includes("phase20SignaturePanel") && app.includes("signedManifestPolicy") && app.includes("phase20.signed.manifest-policy.v1"));
assert("frontend renders phase 20 plugin installation workflow", app.includes("phase20InstallPanel") && app.includes("pluginInstallationWorkflow") && app.includes("phase20.plugin.installation-workflow.v1"));
assert("css styles phase 20 platform panel", css.includes("phase20-platform-section") && css.includes("phase20-summary-grid") && css.includes("phase20-grid"));
assert("phase 20 preserves phase 19 import plan", server.includes("phase19ImportPlan") && app.includes("phase19ImportSection") && operations.includes("phase19-readiness"));
assert("smoke covers phase 20 version and export", apiSmoke.includes("version API reports phase 20") && apiSmoke.includes("export includes phase 20 platform plan") && apiSmoke.includes("phase20.plugin.manifest.v1") && apiSmoke.includes("deny-until-reviewed") && apiSmoke.includes("phase20.plugin.audit.v1") && apiSmoke.includes("phase20.builtIn.registry.v1") && apiSmoke.includes("phase20.extension.contract-tests.v1") && apiSmoke.includes("phase20.plugin.sandbox-boundary.v1") && apiSmoke.includes("phase20.no-code.template-pack.v1") && apiSmoke.includes("phase20.signed.manifest-policy.v1") && apiSmoke.includes("phase20.plugin.installation-workflow.v1") && apiSmoke.includes("phase20.template.preview-fixtures.v1"));
assert("README documents phase 20", readme.includes("第二十阶段") && readme.includes("插件生态"));
assert("whitepaper documents phase 20", whitepaper.includes("第二十阶段") && whitepaper.includes("插件生态"));
assert("plan documents phase 20", plan.includes("当前阶段：阶段 20") && plan.includes("phase20-template-preview-fixtures"));

console.log("Phase 20 readiness checks passed.");
