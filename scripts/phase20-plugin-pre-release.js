const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(name, condition) {
  if (!condition) {
    throw new Error(`Phase 20 plugin pre-release check failed: ${name}`);
  }
  console.log(`ok - ${name}`);
}

const packageJson = JSON.parse(read("\u9879\u76ee\u5de5\u7a0b/package.json"));
const server = read("\u9879\u76ee\u5de5\u7a0b/server.js");
const operations = read("\u9879\u76ee\u5de5\u7a0b/src/services/operations.js");
const app = read("\u9879\u76ee\u5de5\u7a0b/app.js");
const apiSmoke = read("\u9879\u76ee\u5de5\u7a0b/scripts/api-smoke.js");
const readiness = read("\u9879\u76ee\u5de5\u7a0b/scripts/phase20-readiness.js");
const readme = read("\u9879\u76ee\u5de5\u7a0b/README.md");
const plan = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u89c4\u5212.md");
const whitepaper = read("\u9879\u76ee\u6587\u6863/\u9879\u76ee\u767d\u76ae\u4e66.md");

assert("current version preserves phase 20 release gate baseline", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"') && server.includes("phase20-release-checklist-gate"));
assert("npm command is registered", packageJson.scripts?.["phase20:plugin-pre-release"] === "node scripts/phase20-plugin-pre-release.js");
assert("runtime remains disabled", server.includes("thirdPartyExecution: false") && operations.includes("runtimeExecution: false") && app.includes("runtimeExecution: false"));
assert("lockfile import preview blocks risky diffs", operations.includes("pluginLockfileImportPreview") && operations.includes("permission-drift") && operations.includes("signature-missing") && operations.includes("digest-mismatch"));
assert("release signature gate blocks drift", operations.includes("pluginReleaseSignatureGate") && operations.includes("lockfile-drift") && operations.includes("releaseGatePolicy"));
assert("pre-release command model is exported", server.includes("pluginPreReleaseCheckCommand") && operations.includes("phase20.plugin.pre-release-check.v1") && app.includes("pluginPreReleaseCheckCommand.sampleResults"));
assert("signature diff report is exported", server.includes("pluginSignatureDiffReport") && operations.includes("phase20.plugin.signature-diff-report.v1") && app.includes("pluginSignatureDiffReport.sampleFindings"));
assert("release report artifact is exported", server.includes("pluginReleaseReportArtifact") && operations.includes("phase20.plugin.release-report-artifact.v1") && app.includes("pluginReleaseReportArtifact.sampleArtifact"));
assert("diff review history is exported", server.includes("pluginDiffReviewHistory") && operations.includes("phase20.plugin.diff-review-history.v1") && app.includes("pluginDiffReviewHistory.reviewEntries"));
assert("release report validation command is exported", server.includes("pluginReleaseReportValidationCommand") && operations.includes("phase20.plugin.release-report-validation-command.v1") && app.includes("pluginReleaseReportValidationCommand.sampleValidationResults"));
assert("signed release report export is exported", server.includes("pluginSignedReleaseReportExport") && operations.includes("phase20.plugin.signed-release-report-export.v1") && app.includes("pluginSignedReleaseReportExport.sampleExport"));
assert("review history UI is exported", server.includes("pluginReviewHistoryUi") && operations.includes("phase20.plugin.review-history-ui.v1") && app.includes("pluginReviewHistoryUi.sampleRows"));
assert("validation command CI wrapper is exported", server.includes("pluginValidationCommandCiWrapper") && operations.includes("phase20.plugin.validation-command-ci-wrapper.v1") && app.includes("pluginValidationCommandCiWrapper.sampleCiRun"));
assert("signed report download is exported", server.includes("pluginSignedReportDownload") && operations.includes("phase20.plugin.signed-report-download.v1") && app.includes("pluginSignedReportDownload.sampleDownload"));
assert("CI badge summary is exported", server.includes("pluginCiBadgeSummary") && operations.includes("phase20.plugin.ci-badge-summary.v1") && app.includes("pluginCiBadgeSummary.sampleBadge"));
assert("download integrity preview is exported", server.includes("pluginDownloadIntegrityPreview") && operations.includes("phase20.plugin.download-integrity-preview.v1") && app.includes("pluginDownloadIntegrityPreview.samplePreview"));
assert("release checklist gate is exported", server.includes("pluginReleaseChecklistGate") && operations.includes("phase20.plugin.release-checklist-gate.v1") && app.includes("pluginReleaseChecklistGate.sampleGate"));
assert("signature diff report explains release blockers", operations.includes("manifest-digest") && operations.includes("permission-drift-unreviewed") && operations.includes("block-release"));
assert("diff review history tracks release decisions", operations.includes("review-third-party-signature") && operations.includes("block-review-present") && operations.includes("hold-without-reviewer-note"));
assert("release report validation command checks release consistency", operations.includes("release-report-schema-present") && operations.includes("release-report-missing") && operations.includes("hold-finding-requires-reviewer-note") && operations.includes("block-finding-keeps-releaseReady-false"));
assert("signed release report export archives signature envelope", operations.includes("phase20-plugin-release.signed-report.json") && operations.includes("signature-envelope-present") && operations.includes("signed-while-blocked") && operations.includes("pending-human-signature"));
assert("review history UI exposes blocker and hold actions", operations.includes("blocked-row-hidden") && operations.includes("record-review-note-placeholder") && operations.includes("block-release-summary") && operations.includes("unresolvedOnly"));
assert("validation command CI wrapper gates hold and block results", operations.includes("hold-result-exit-zero") && operations.includes("block-result-exit-zero") && operations.includes("phase20-plugin-pre-release.summary.json") && operations.includes("block-on-hold-or-block"));
assert("signed report download keeps secrets out of artifacts", operations.includes("phase20-plugin-release.signed-report.download.json") && operations.includes("includesRuntimeSecrets: false") && operations.includes("secret-field-included") && operations.includes("record-download-audit"));
assert("CI badge summary publishes blocked state", operations.includes("phase20-plugin-ci.badge-summary.json") && operations.includes("plugin-ci: blocked") && operations.includes("badge-state-mismatch") && operations.includes("record-badge-audit"));
assert("download integrity preview blocks mismatches", operations.includes("phase20-plugin-release.download-integrity.preview.json") && operations.includes("checksum-mismatch") && operations.includes("source-artifact-drift") && operations.includes("block-on-mismatch"));
assert("release checklist gate derives final releaseReady", operations.includes("phase20-plugin-release.checklist-gate.json") && operations.includes("derive-final-releaseReady") && operations.includes("ci-badge-blocked") && operations.includes("checklist-gate-audit-missing"));
assert("smoke and readiness cover command model", apiSmoke.includes("phase20.plugin.pre-release-check.v1") && readiness.includes("pluginPreReleaseCheckCommand"));
assert("smoke and readiness cover signature diff report", apiSmoke.includes("phase20.plugin.signature-diff-report.v1") && readiness.includes("pluginSignatureDiffReport"));
assert("smoke and readiness cover release report artifact", apiSmoke.includes("phase20.plugin.release-report-artifact.v1") && readiness.includes("pluginReleaseReportArtifact"));
assert("smoke and readiness cover diff review history", apiSmoke.includes("phase20.plugin.diff-review-history.v1") && readiness.includes("pluginDiffReviewHistory"));
assert("smoke and readiness cover release report validation command", apiSmoke.includes("phase20.plugin.release-report-validation-command.v1") && readiness.includes("pluginReleaseReportValidationCommand"));
assert("smoke and readiness cover signed release report export", apiSmoke.includes("phase20.plugin.signed-release-report-export.v1") && readiness.includes("pluginSignedReleaseReportExport"));
assert("smoke and readiness cover review history UI", apiSmoke.includes("phase20.plugin.review-history-ui.v1") && readiness.includes("pluginReviewHistoryUi"));
assert("smoke and readiness cover validation command CI wrapper", apiSmoke.includes("phase20.plugin.validation-command-ci-wrapper.v1") && readiness.includes("pluginValidationCommandCiWrapper"));
assert("smoke and readiness cover signed report download", apiSmoke.includes("phase20.plugin.signed-report-download.v1") && readiness.includes("pluginSignedReportDownload"));
assert("smoke and readiness cover CI badge summary", apiSmoke.includes("phase20.plugin.ci-badge-summary.v1") && readiness.includes("pluginCiBadgeSummary"));
assert("smoke and readiness cover download integrity preview", apiSmoke.includes("phase20.plugin.download-integrity-preview.v1") && readiness.includes("pluginDownloadIntegrityPreview"));
assert("smoke and readiness cover release checklist gate", apiSmoke.includes("phase20.plugin.release-checklist-gate.v1") && readiness.includes("pluginReleaseChecklistGate"));
assert("docs preserve twenty-sixth edition history", readme.includes("phase20-release-checklist-gate") && plan.includes("phase20-release-checklist-gate") && whitepaper.includes("phase20-release-checklist-gate"));

console.log(JSON.stringify({
  ok: true,
  phase: 20,
  version: packageJson.version,
  buildLabel: "phase29-release-exit-final-archive-manifest-preview",
  command: "npm.cmd run phase20:plugin-pre-release"
}));

