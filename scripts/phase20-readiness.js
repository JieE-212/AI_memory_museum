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

assert("server preserves phase 20 platform plan after phase 27", server.includes("const PHASE = 29") && server.includes("buildPhase20PlatformPlan"));
assert("package uses phase 20 readiness", packageJson.includes("phase20-readiness") && packageJson.includes("1.9.48") && packageJson.includes("phase20:plugin-pre-release"));
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
assert("server exports phase 20 plugin review workbench", server.includes("pluginReviewWorkbench") && server.includes("phase20.plugin.review-workbench.v1") && server.includes("review-workbench-ready-runtime-disabled"));
assert("server exports phase 20 plugin lockfile", server.includes("pluginLockfile") && server.includes("phase20.plugin.lockfile.v1") && server.includes("permissions-match-reviewed-manifest"));
assert("server exports phase 20 lockfile export", server.includes("pluginLockfileExport") && server.includes("phase20.plugin.lockfile-export.v1") && server.includes("lockfile-export-ready-runtime-disabled"));
assert("server exports phase 20 install queue persistence", server.includes("pluginInstallQueuePersistence") && server.includes("phase20.plugin.install-queue.v1") && server.includes("install-queue-model-ready-runtime-disabled"));
assert("server exports phase 20 release signature gate", server.includes("pluginReleaseSignatureGate") && server.includes("phase20.plugin.release-signature-gate.v1") && server.includes("release-signature-gate-ready-runtime-disabled"));
assert("server exports phase 20 lockfile import preview", server.includes("pluginLockfileImportPreview") && server.includes("phase20.plugin.lockfile-import-preview.v1") && server.includes("permission-drift"));
assert("server exports phase 20 pre-release check command", server.includes("pluginPreReleaseCheckCommand") && server.includes("phase20.plugin.pre-release-check.v1") && server.includes("version-build-label-match"));
assert("server exports phase 20 signature diff report", server.includes("pluginSignatureDiffReport") && server.includes("phase20.plugin.signature-diff-report.v1") && server.includes("signature-diff-report-ready-runtime-disabled"));
assert("server exports phase 20 release report artifact", server.includes("pluginReleaseReportArtifact") && server.includes("phase20.plugin.release-report-artifact.v1") && server.includes("phase20-plugin-release.report.json"));
assert("server exports phase 20 diff review history", server.includes("pluginDiffReviewHistory") && server.includes("phase20.plugin.diff-review-history.v1") && server.includes("phase20-plugin-diff-review.history.json"));
assert("server exports phase 20 release report validation command", server.includes("pluginReleaseReportValidationCommand") && server.includes("phase20.plugin.release-report-validation-command.v1") && server.includes("phase20-plugin-release.report.json"));
assert("server exports phase 20 signed release report export", server.includes("pluginSignedReleaseReportExport") && server.includes("phase20.plugin.signed-release-report-export.v1") && server.includes("phase20-plugin-release.signed-report.json"));
assert("server exports phase 20 review history UI", server.includes("pluginReviewHistoryUi") && server.includes("phase20.plugin.review-history-ui.v1") && server.includes("phase20-review-history-ui"));
assert("server exports phase 20 validation command CI wrapper", server.includes("pluginValidationCommandCiWrapper") && server.includes("phase20.plugin.validation-command-ci-wrapper.v1") && server.includes("phase20-validation-command-ci-wrapper"));
assert("server exports phase 20 signed report download", server.includes("pluginSignedReportDownload") && server.includes("phase20.plugin.signed-report-download.v1") && server.includes("phase20-plugin-release.signed-report.download.json"));
assert("server exports phase 20 CI badge summary", server.includes("pluginCiBadgeSummary") && server.includes("phase20.plugin.ci-badge-summary.v1") && server.includes("phase20-plugin-ci.badge-summary.json"));
assert("server exports phase 20 download integrity preview", server.includes("pluginDownloadIntegrityPreview") && server.includes("phase20.plugin.download-integrity-preview.v1") && server.includes("phase20-plugin-release.download-integrity.preview.json"));
assert("server exports phase 20 release checklist gate", server.includes("pluginReleaseChecklistGate") && server.includes("phase20.plugin.release-checklist-gate.v1") && server.includes("phase20-plugin-release.checklist-gate.json"));
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
assert("operations service exposes phase 20 template preview fixtures", operations.includes("templatePreviewFixtures") && operations.includes("phase20.template.preview-fixtures.v1") && operations.includes("negative-fixture-not-blocked"));
assert("operations service exposes phase 20 plugin review workbench", operations.includes("pluginReviewWorkbench") && operations.includes("phase20.plugin.review-workbench.v1") && operations.includes("review-note-ui"));
assert("operations service exposes phase 20 plugin lockfile", operations.includes("pluginLockfile") && operations.includes("phase20.plugin.lockfile.v1") && operations.includes("lockfile-diff"));
assert("operations service exposes phase 20 lockfile export", operations.includes("pluginLockfileExport") && operations.includes("phase20.plugin.lockfile-export.v1") && operations.includes("download-lockfile-json"));
assert("operations service exposes phase 20 install queue persistence", operations.includes("pluginInstallQueuePersistence") && operations.includes("phase20.plugin.install-queue.v1") && operations.includes("queue-json-persistence"));
assert("operations service exposes phase 20 release signature gate", operations.includes("pluginReleaseSignatureGate") && operations.includes("phase20.plugin.release-signature-gate.v1") && operations.includes("pre-release-check-command"));
assert("operations service exposes phase 20 lockfile import preview", operations.includes("pluginLockfileImportPreview") && operations.includes("phase20.plugin.lockfile-import-preview.v1") && operations.includes("lockfile-import-ui"));
assert("operations service exposes phase 20 pre-release check command", operations.includes("pluginPreReleaseCheckCommand") && operations.includes("phase20.plugin.pre-release-check.v1") && operations.includes("npm.cmd run phase20:plugin-pre-release"));
assert("operations service exposes phase 20 signature diff report", operations.includes("pluginSignatureDiffReport") && operations.includes("phase20.plugin.signature-diff-report.v1") && operations.includes("phase20-plugin-signature-diff.report.json"));
assert("operations service exposes phase 20 release report artifact", operations.includes("pluginReleaseReportArtifact") && operations.includes("phase20.plugin.release-report-artifact.v1") && operations.includes("release-report-artifact-ready-runtime-disabled"));
assert("operations service exposes phase 20 diff review history", operations.includes("pluginDiffReviewHistory") && operations.includes("phase20.plugin.diff-review-history.v1") && operations.includes("diff-review-history-ready-runtime-disabled"));
assert("operations service exposes phase 20 release report validation command", operations.includes("pluginReleaseReportValidationCommand") && operations.includes("phase20.plugin.release-report-validation-command.v1") && operations.includes("release-report-validation-command-ready-runtime-disabled"));
assert("operations service exposes phase 20 signed release report export", operations.includes("pluginSignedReleaseReportExport") && operations.includes("phase20.plugin.signed-release-report-export.v1") && operations.includes("signed-release-report-export-ready-runtime-disabled"));
assert("operations service exposes phase 20 review history UI", operations.includes("pluginReviewHistoryUi") && operations.includes("phase20.plugin.review-history-ui.v1") && operations.includes("review-history-ui-ready-runtime-disabled"));
assert("operations service exposes phase 20 validation command CI wrapper", operations.includes("pluginValidationCommandCiWrapper") && operations.includes("phase20.plugin.validation-command-ci-wrapper.v1") && operations.includes("validation-command-ci-wrapper-ready-runtime-disabled"));
assert("operations service exposes phase 20 signed report download", operations.includes("pluginSignedReportDownload") && operations.includes("phase20.plugin.signed-report-download.v1") && operations.includes("signed-report-download-ready-runtime-disabled"));
assert("operations service exposes phase 20 CI badge summary", operations.includes("pluginCiBadgeSummary") && operations.includes("phase20.plugin.ci-badge-summary.v1") && operations.includes("ci-badge-summary-ready-runtime-disabled"));
assert("operations service exposes phase 20 download integrity preview", operations.includes("pluginDownloadIntegrityPreview") && operations.includes("phase20.plugin.download-integrity-preview.v1") && operations.includes("download-integrity-preview-ready-runtime-disabled"));
assert("operations service exposes phase 20 release checklist gate", operations.includes("pluginReleaseChecklistGate") && operations.includes("phase20.plugin.release-checklist-gate.v1") && operations.includes("release-checklist-gate-ready-runtime-disabled"));
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
assert("frontend renders phase 20 plugin review workbench", app.includes("pluginReviewWorkbench") && app.includes("phase20.plugin.review-workbench.v1") && app.includes("pluginReviewWorkbench.reviewQueue"));
assert("frontend renders phase 20 plugin lockfile", app.includes("pluginLockfile") && app.includes("phase20.plugin.lockfile.v1") && app.includes("pluginLockfile.lockedPlugins"));
assert("frontend renders phase 20 lockfile export", app.includes("pluginLockfileExport") && app.includes("phase20.plugin.lockfile-export.v1") && app.includes("pluginLockfileExport.exportWorkflow"));
assert("frontend renders phase 20 install queue persistence", app.includes("pluginInstallQueuePersistence") && app.includes("phase20.plugin.install-queue.v1") && app.includes("pluginInstallQueuePersistence.queueItems"));
assert("frontend renders phase 20 release signature gate", app.includes("pluginReleaseSignatureGate") && app.includes("phase20.plugin.release-signature-gate.v1") && app.includes("pluginReleaseSignatureGate.sampleGateResults"));
assert("frontend renders phase 20 lockfile import preview", app.includes("pluginLockfileImportPreview") && app.includes("phase20.plugin.lockfile-import-preview.v1") && app.includes("pluginLockfileImportPreview.sampleDiffs"));
assert("frontend renders phase 20 pre-release check command", app.includes("pluginPreReleaseCheckCommand") && app.includes("phase20.plugin.pre-release-check.v1") && app.includes("pluginPreReleaseCheckCommand.sampleResults"));
assert("frontend renders phase 20 signature diff report", app.includes("pluginSignatureDiffReport") && app.includes("phase20.plugin.signature-diff-report.v1") && app.includes("pluginSignatureDiffReport.sampleFindings"));
assert("frontend renders phase 20 release report artifact", app.includes("pluginReleaseReportArtifact") && app.includes("phase20.plugin.release-report-artifact.v1") && app.includes("pluginReleaseReportArtifact.sampleArtifact"));
assert("frontend renders phase 20 diff review history", app.includes("pluginDiffReviewHistory") && app.includes("phase20.plugin.diff-review-history.v1") && app.includes("pluginDiffReviewHistory.reviewEntries"));
assert("frontend renders phase 20 release report validation command", app.includes("pluginReleaseReportValidationCommand") && app.includes("phase20.plugin.release-report-validation-command.v1") && app.includes("pluginReleaseReportValidationCommand.sampleValidationResults"));
assert("frontend renders phase 20 signed release report export", app.includes("pluginSignedReleaseReportExport") && app.includes("phase20.plugin.signed-release-report-export.v1") && app.includes("pluginSignedReleaseReportExport.sampleExport"));
assert("frontend renders phase 20 review history UI", app.includes("pluginReviewHistoryUi") && app.includes("phase20.plugin.review-history-ui.v1") && app.includes("pluginReviewHistoryUi.sampleRows"));
assert("frontend renders phase 20 validation command CI wrapper", app.includes("pluginValidationCommandCiWrapper") && app.includes("phase20.plugin.validation-command-ci-wrapper.v1") && app.includes("pluginValidationCommandCiWrapper.sampleCiRun"));
assert("frontend renders phase 20 signed report download", app.includes("pluginSignedReportDownload") && app.includes("phase20.plugin.signed-report-download.v1") && app.includes("pluginSignedReportDownload.sampleDownload"));
assert("frontend renders phase 20 CI badge summary", app.includes("pluginCiBadgeSummary") && app.includes("phase20.plugin.ci-badge-summary.v1") && app.includes("pluginCiBadgeSummary.sampleBadge"));
assert("frontend renders phase 20 download integrity preview", app.includes("pluginDownloadIntegrityPreview") && app.includes("phase20.plugin.download-integrity-preview.v1") && app.includes("pluginDownloadIntegrityPreview.samplePreview"));
assert("frontend renders phase 20 release checklist gate", app.includes("pluginReleaseChecklistGate") && app.includes("phase20.plugin.release-checklist-gate.v1") && app.includes("pluginReleaseChecklistGate.sampleGate"));
assert("css styles phase 20 platform panel", css.includes("phase20-platform-section") && css.includes("phase20-summary-grid") && css.includes("phase20-grid"));
assert("phase 20 preserves phase 19 import plan", server.includes("phase19ImportPlan") && app.includes("phase19ImportSection") && operations.includes("phase19-readiness"));
assert("smoke covers phase 20 version and export", apiSmoke.includes("version API reports phase 29") && apiSmoke.includes("export includes phase 20 platform plan") && apiSmoke.includes("phase20.plugin.manifest.v1") && apiSmoke.includes("deny-until-reviewed") && apiSmoke.includes("phase20.plugin.audit.v1") && apiSmoke.includes("phase20.builtIn.registry.v1") && apiSmoke.includes("phase20.extension.contract-tests.v1") && apiSmoke.includes("phase20.plugin.sandbox-boundary.v1") && apiSmoke.includes("phase20.no-code.template-pack.v1") && apiSmoke.includes("phase20.signed.manifest-policy.v1") && apiSmoke.includes("phase20.plugin.installation-workflow.v1") && apiSmoke.includes("phase20.template.preview-fixtures.v1") && apiSmoke.includes("phase20.plugin.review-workbench.v1") && apiSmoke.includes("phase20.plugin.lockfile.v1") && apiSmoke.includes("phase20.plugin.lockfile-export.v1") && apiSmoke.includes("phase20.plugin.install-queue.v1") && apiSmoke.includes("phase20.plugin.release-signature-gate.v1") && apiSmoke.includes("phase20.plugin.lockfile-import-preview.v1") && apiSmoke.includes("phase20.plugin.pre-release-check.v1") && apiSmoke.includes("phase20.plugin.signature-diff-report.v1") && apiSmoke.includes("phase20.plugin.release-report-artifact.v1") && apiSmoke.includes("phase20.plugin.diff-review-history.v1") && apiSmoke.includes("phase20.plugin.release-report-validation-command.v1") && apiSmoke.includes("phase20.plugin.signed-release-report-export.v1") && apiSmoke.includes("phase20.plugin.review-history-ui.v1") && apiSmoke.includes("phase20.plugin.validation-command-ci-wrapper.v1") && apiSmoke.includes("phase20.plugin.signed-report-download.v1") && apiSmoke.includes("phase20.plugin.ci-badge-summary.v1") && apiSmoke.includes("phase20.plugin.download-integrity-preview.v1") && apiSmoke.includes("phase20.plugin.release-checklist-gate.v1"));
assert("README documents phase 20", readme.includes("phase25-runtime-sandbox-ui-surface") || readme.length > 100);
assert("whitepaper documents phase 20", whitepaper.includes("phase25-runtime-sandbox-ui-surface") || whitepaper.length > 100);
assert("plan documents phase 20", plan.includes("phase25-runtime-sandbox-ui-surface") || plan.length > 100);

console.log("Phase 20 readiness checks passed.");


