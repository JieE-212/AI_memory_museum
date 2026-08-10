"use strict";

const { spawnSync } = require("node:child_process");

const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function isSha(value) { return SHA_PATTERN.test(String(value || "")); }
function isTimestamp(value) { return ISO_TIMESTAMP_PATTERN.test(String(value || "")); }

function validateReleaseGitTopology({ cwd, tag, runtimeCommit, docsCommit }) {
  const failures = [];
  if (!cwd || !tag || !isSha(runtimeCommit) || !isSha(docsCommit)) {
    return ["release git topology requires a repository, tag, runtime commit A and docs commit B"];
  }
  const objectType = gitOutput(cwd, ["cat-file", "-t", `refs/tags/${tag}`]);
  const peeledCommit = gitOutput(cwd, ["rev-parse", `refs/tags/${tag}^{commit}`]);
  const headCommit = gitOutput(cwd, ["rev-parse", "HEAD"]);
  if (objectType !== "tag") failures.push("release tag must be an annotated tag object");
  if (peeledCommit !== runtimeCommit) failures.push("release tag must peel to runtime commit A");
  if (headCommit !== docsCommit) failures.push("released repository HEAD must be documentation commit B");
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", runtimeCommit, docsCommit], { cwd, windowsHide: true });
  if (ancestor.status !== 0) failures.push("runtime commit A must be an ancestor of documentation commit B");
  const changedPaths = splitLines(gitOutput(cwd, ["diff", "--name-only", runtimeCommit, docsCommit]));
  if (!changedPaths.length || changedPaths.some((filePath) => !isReleaseDocumentationPath(filePath))) {
    failures.push("commit B must contain documentation and release evidence only");
  }
  return failures;
}

function validateReleaseEvidenceManifest(manifest, contract) {
  const failures = [];
  const releaseCommit = contract?.release?.releaseCommit;
  const docsCommit = manifest?.source?.docsCommit;
  const production = manifest?.productionVerification || {};
  const repositories = manifest?.repositories || {};

  if (manifest?.format !== "time-isle-release-evidence-v1") {
    failures.push("release evidence manifest format is invalid");
  }
  if (manifest?.status !== "released" || contract?.status !== "released") {
    failures.push("complete release evidence requires a released contract");
  }
  if (manifest?.version !== contract?.version || manifest?.schemaVersion !== contract?.schemaVersion || manifest?.expectedTag !== contract?.tag) {
    failures.push("release evidence identity must match the released contract");
  }
  if (!isTimestamp(manifest?.generatedAt)) {
    failures.push("release evidence must record an ISO UTC generation timestamp");
  }
  if (!isSha(releaseCommit) || manifest?.source?.releaseCommit !== releaseCommit) {
    failures.push("release evidence must bind runtime commit A from the contract");
  }
  if (!isSha(docsCommit) || docsCommit === releaseCommit || manifest?.source?.commit !== docsCommit) {
    failures.push("release evidence must bind the distinct documentation commit B after it exists");
  }
  if (manifest?.source?.dirty !== false || manifest?.source?.runtimeIsAncestorOfDocs !== true) {
    failures.push("release evidence must come from a clean B with runtime A as its ancestor");
  }
  if (manifest?.source?.tagObjectType !== "tag" || manifest?.source?.tagPeeledCommit !== releaseCommit) {
    failures.push("release evidence must bind an annotated tag that peels to runtime commit A");
  }

  for (const remote of ["github", "gitee"]) {
    const evidence = repositories[remote] || {};
    if (!isSha(evidence.mainCommit) || !isSha(evidence.tagCommit) || evidence.mainCommit !== docsCommit || evidence.tagCommit !== releaseCommit || evidence.tagAnnotated !== true) {
      failures.push(`release evidence must bind ${remote} main to docs commit B and tag to runtime commit A`);
    }
  }
  if (repositories.sameCommitVerified !== true) {
    failures.push("release evidence must confirm the same A/B topology on both remotes");
  }

  if (!Array.isArray(manifest?.gates) || manifest.gates.length !== contract?.requiredGates?.length || manifest.gates.some((gate) => gate.result !== "success")) {
    failures.push("release evidence must record every required gate as successful");
  }
  if (production.status !== "verified" || production.observedVersion !== contract?.version || production.observedSchemaVersion !== contract?.schemaVersion || production.observedReleaseCommit !== releaseCommit) {
    failures.push("release evidence production identity must match runtime commit A");
  }
  const deployments = production.deployments || {};
  for (const target of ["vercel", "cloudbase", "wakeup"]) {
    if (!String(deployments[target]?.id || "").trim() || deployments[target]?.sourceCommit !== releaseCommit) {
      failures.push(`release evidence must bind ${target} deployment to runtime commit A`);
    }
  }
  if (!Array.isArray(production.probes) || production.probes.length < 2) {
    failures.push("release evidence must include CloudBase and Vercel API probes");
  } else {
    for (const probe of production.probes) {
      if (probe.version !== contract?.version || probe.schemaVersion !== contract?.schemaVersion || probe.deploymentCommit !== releaseCommit || probe.visitorWritesAllowed !== false || probe.blockedBeforeBodyRead !== true || probe.externalAiAllowed !== false || probe.encryptionAtRest !== false || probe.zeroBodyWrites !== true) {
        failures.push(`release evidence probe ${String(probe.id || "unknown")} does not match the release trust boundary`);
      }
    }
  }
  return failures;
}

function isReleaseDocumentationPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/gu, "/");
  return normalized.endsWith(".md") || /^release\/(?:evidence\/)?[^/]+\.json$/u.test(normalized);
}

function gitOutput(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function splitLines(value) {
  return String(value || "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}

function validateReleaseContractState(contract) {
  const failures = [];
  const status = String(contract?.status || "");
  const production = contract?.productionVerification || {};

  if (!["candidate-local-only", "released"].includes(status)) {
    failures.push("release contract status must be candidate-local-only or released");
  }
  if (production.requiredBeforeReleased !== true) {
    failures.push("production verification must remain required before release");
  }

  if (status === "candidate-local-only") {
    if (production.status !== "pending-local-acceptance-and-deploy") {
      failures.push("candidate contract must keep production verification pending");
    }
    if (contract.release) failures.push("candidate contract must not contain a release binding");
    for (const key of ["observedVersion", "observedSchemaVersion", "observedCommit", "observedReleaseCommit", "verifiedAt", "evidenceManifest", "manifestPath", "manifestSha256", "deployments", "probes"]) {
      if (Object.prototype.hasOwnProperty.call(production, key)) {
        failures.push(`candidate contract must not contain production evidence field ${key}`);
      }
    }
    return failures;
  }

  const release = contract?.release || {};
  if (!isSha(release.releaseCommit)) {
    failures.push("released contract must record a 40-character release commit");
  }
  if (Object.prototype.hasOwnProperty.call(release, "docsCommit") || Object.prototype.hasOwnProperty.call(release, "remoteCommits")) {
    failures.push("documentation commit B and remote main SHAs must live in the post-commit evidence manifest, not the self-referential release contract");
  }
  if (release.topologyEvidence !== "post-docs-commit-manifest") {
    failures.push("released contract must declare post-docs-commit topology evidence");
  }
  if (release.tag !== contract?.tag) {
    failures.push("released contract tag must match the expected tag");
  }
  if (release.tagAnnotated !== true) {
    failures.push("released contract must record an annotated release tag");
  }
  if (release.tagPeeledCommit !== release.releaseCommit) {
    failures.push("released contract tag must peel to the runtime commit");
  }
  if (!isTimestamp(release.releasedAt)) {
    failures.push("released contract must record an ISO UTC release timestamp");
  }
  if (!/^https:\/\/[^\s]+$/iu.test(String(release.ciRunUrl || ""))) {
    failures.push("released contract must record the CI evidence URL");
  }
  if (!/^https:\/\/[^\s]+$/iu.test(String(release.preReleaseEvidence?.url || "")) || !/^[0-9a-f]{64}$/iu.test(String(release.preReleaseEvidence?.sha256 || ""))) {
    failures.push("released contract must bind the pre-release evidence URL and SHA-256");
  }
  if (production.status !== "verified") {
    failures.push("released contract must mark production verification as verified");
  }
  if (production.observedVersion !== contract?.version || production.observedSchemaVersion !== contract?.schemaVersion) {
    failures.push("released production evidence must match version and schema");
  }
  if (!isTimestamp(production.verifiedAt)) {
    failures.push("released production evidence must record an ISO UTC verification timestamp");
  }
  if (production.manifestKind !== "pre-release-production-probe") {
    failures.push("released production manifest must be the pre-release probe artifact; post-B topology belongs in the external evidence manifest");
  }
  if (!String(production.manifestPath || "").trim() || !/^[0-9a-f]{64}$/iu.test(String(production.manifestSha256 || ""))) {
    failures.push("released production evidence must name the pre-release probe manifest and its SHA-256");
  }
  const deployments = production.deployments || {};
  for (const target of ["vercel", "cloudbase", "wakeup"]) {
    if (!String(deployments[target]?.id || "").trim()) failures.push(`released production evidence must record the ${target} deployment id`);
    if (deployments[target]?.sourceCommit !== release.releaseCommit) failures.push(`released production evidence must bind ${target} to release commit A`);
  }
  if (!Array.isArray(production.probes) || production.probes.length < 2) {
    failures.push("released production evidence must include API probes for CloudBase and Vercel");
  } else {
    for (const probe of production.probes) {
      if (probe.version !== contract.version || probe.schemaVersion !== contract.schemaVersion || probe.deploymentCommit !== release.releaseCommit || probe.visitorWritesAllowed !== false || probe.blockedBeforeBodyRead !== true || probe.externalAiAllowed !== false || probe.encryptionAtRest !== false || probe.zeroBodyWrites !== true) {
        failures.push(`released production probe ${String(probe.id || "unknown")} does not match the release trust boundary`);
      }
    }
  }

  return failures;
}

module.exports = {
  SHA_PATTERN,
  ISO_TIMESTAMP_PATTERN,
  isSha,
  isTimestamp,
  isReleaseDocumentationPath,
  validateReleaseContractState,
  validateReleaseGitTopology,
  validateReleaseEvidenceManifest
};
