"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRuntimeTrust } = require("../lib/runtime-trust");
const { SHA_PATTERN, validateReleaseContractState, validateReleaseGitTopology, validateReleaseEvidenceManifest } = require("../lib/release-contract");
const { APP_VERSION, SCHEMA_VERSION } = require("../lib/release-identity");

const root = path.resolve(__dirname, "..");
const contractPath = path.join(root, "release", `v${APP_VERSION}.json`);
const contract = readJson(contractPath);
const pkg = readJson(path.join(root, "package.json"));
const serverSource = readText(path.join(root, "server.js"));
const indexSource = readText(path.join(root, "public", "index.html"));
const serviceWorkerSource = readText(path.join(root, "public", "sw.js"));
const wakeupSource = readText(path.join(root, "deploy", "cloudbase", "wakeup", "wakeup.js"));
const modelManifest = readJson(path.join(root, contract.model.manifestPath));
const evaluationFixturePath = path.join(root, contract.semanticEvaluation.fixturePath);
const evaluationFixture = readJson(evaluationFixturePath);
const failures = [];

check(contract.format === "time-isle-release-contract-v1", "release contract format is fixed");
for (const failure of validateReleaseContractState(contract)) failures.push(failure);
check(/^\d+\.\d+\.\d+$/.test(contract.version) && contract.tag === `v${contract.version}`, "version and expected tag agree");
check(contract.annotatedTagRequired === true, "release requires an annotated tag");
check(contract.schemaVersion === SCHEMA_VERSION, "schema matches the runtime identity");
check(contract.syntheticDataOnly === true && contract.semanticEvaluation.syntheticDataOnly === true, "release and semantic evidence use only synthetic fixtures");
check(contract.claims.demoWritePolicy === "all-non-read-methods-blocked-before-body", "Demo zero-body write policy is declared");
check(contract.claims.externalAi === "explicit-per-operation-consent-and-matching-trust-contract", "external AI consent boundary is declared");
check(contract.claims.encryptionAtRest === false && contract.claims.v18Gate === "NO-GO", "V18 encryption remains an explicit NO-GO");
check(contract.claims.productSurface === "responsive-web-pwa-not-native-app" && contract.claims.privateCloudSync === false, "product surface and sync boundary are honest");
check(pkg.version === contract.version, "package version matches the release contract");
check(APP_VERSION === contract.version && SCHEMA_VERSION === contract.schemaVersion && serverSource.includes('require("./lib/release-identity")'), "server version and schema match the release contract");
check(indexSource.includes(`<span id="footerVersion">v${contract.version}</span>`) && indexSource.includes(`?v=${contract.version}`), "HTML identity and cache-busters match the release contract");
check(serviceWorkerSource.includes(`v${contract.version}`), "service worker cache identity matches the release contract");
check(wakeupSource.includes("#collection") && !wakeupSource.includes("#reflect"), "CloudBase wakeup enters the collection rather than an advanced review view");

const trustProbe = createRuntimeTrust({
  appVersion: contract.version,
  schemaVersion: contract.schemaVersion,
  interviewDemo: true,
  aiEnabled: true,
  environment: {
    AI_BASE_URL: "https://user:secret@example.invalid/v1?token=do-not-expose",
    AI_MODEL: "synthetic-model",
    AI_PROVIDER_LABEL: "Synthetic provider",
    DEPLOYMENT_PLATFORM: "cloudbase"
  },
  deployment: { publicDeployment: true },
  semanticModelId: contract.model.id
});
const trustJson = JSON.stringify(trustProbe);
check(trustProbe.appVersion === contract.version && trustProbe.schemaVersion === contract.schemaVersion && trustProbe.audience === "public-demo", "runtime trust identity matches the contract");
check(trustProbe.storage.visitorWritesAllowed === false && trustProbe.storage.blockedBeforeBodyRead === true, "runtime trust reports the Demo as read-only before body read");
check(trustProbe.externalAi.allowed === false && trustProbe.encryptionAtRest.enabled === false, "runtime trust reports external AI and encryption boundaries truthfully");
check(!trustJson.includes("secret") && !trustJson.includes("do-not-expose") && !trustJson.includes("user:"), "runtime trust never exposes credentials or a complete authenticated URL");

const onnx = modelManifest.files.find((item) => item.path.endsWith("/onnx/model_quantized.onnx"));
check(modelManifest.model.id === contract.model.id && onnx?.sha256 === contract.model.onnxSha256, "model identity and declared ONNX hash match");
check(onnx && sha256File(path.join(root, onnx.path)) === onnx.sha256, "release evidence hashes the actual ONNX asset");
check(evaluationFixture.format === "time-isle-semantic-recall-eval-v1" && evaluationFixture.syntheticDataOnly === true, "semantic fixture is versioned and explicitly fictional");
check(evaluationFixture.topics.length === 20 && evaluationFixture.baseline.maximumRegressionRatio === contract.semanticEvaluation.maximumRegressionRatio, "semantic fixture and 20% regression contract agree");
check(Boolean(evaluationFixture.baseline.quality500 && evaluationFixture.baseline.bySlice500?.["semantic-paraphrase"] && evaluationFixture.baseline.bySlice500?.["literal-control"]), "500-document overall and slice quality baselines are frozen");
check(Array.isArray(contract.requiredGates) && new Set(contract.requiredGates.map((item) => item.id)).size === contract.requiredGates.length, "all independent release gates are uniquely declared");
check(contract.productionVerification.requiredBeforeReleased === true, "production verification remains required before release");
check(Array.isArray(contract.productionVerification.apiProbeTargets) && contract.productionVerification.apiProbeTargets.length === 2, "release contract separates the two API probe targets");
check(Array.isArray(contract.productionVerification.entryTargets) && contract.productionVerification.entryTargets.length === 1, "release contract separates the static entry target");

const git = inspectGit();
if (git.exactTags.includes(contract.tag)) {
  check(git.annotatedTags.includes(contract.tag), `${contract.tag} is annotated when it exists`);
}
if (contract.status === "released") {
  const runtimeCommit = contract.release?.releaseCommit;
  const docsCommit = envOrNull("EVIDENCE_DOCS_COMMIT") || git.commit;
  const tagCommit = gitTagCommit(contract.tag);
  check(SHA_PATTERN.test(String(runtimeCommit || "")), "released contract runtime commit is a full SHA");
  check(git.tagObjectTypes[contract.tag] === "tag", `${contract.tag} is an annotated tag object`);
  check(tagCommit === runtimeCommit, `${contract.tag} resolves to the recorded runtime commit`);
  for (const failure of validateReleaseGitTopology({
    cwd: root,
    tag: contract.tag,
    runtimeCommit,
    docsCommit
  })) failures.push(failure);
}
if (process.env.GITHUB_REF_TYPE === "tag") {
  check(process.env.GITHUB_REF_NAME === contract.tag && git.exactTags.includes(contract.tag) && git.annotatedTags.includes(contract.tag), "tag CI runs only for the exact annotated release tag");
}

const outputIndex = process.argv.indexOf("--write");
let evidencePath = "";
if (process.argv.includes("--require-passed-gates")) {
  const gateStates = contract.requiredGates.map((gate) => evidenceGate(gate));
  const incomplete = gateStates.filter((gate) => gate.result !== "success");
  check(incomplete.length === 0, `all CI gates passed before evidence publication${incomplete.length ? ` (${incomplete.map((item) => `${item.id}:${item.result}`).join(", ")})` : ""}`);
}
if (outputIndex >= 0) {
  const requested = process.argv[outputIndex + 1];
  if (!requested || requested.startsWith("--")) failures.push("--write requires an output path");
  else if (!failures.length) evidencePath = writeEvidence(path.resolve(root, requested), git);
}

if (failures.length) {
  for (const failure of failures) console.error(`not ok - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Release evidence contract checks passed: ${contract.version} / schema ${contract.schemaVersion}${evidencePath ? ` / ${evidencePath}` : ""}.`);
}

function writeEvidence(targetPath, git) {
  const releaseCommit = contract.status === "released" ? contract.release.releaseCommit : envOrNull("EVIDENCE_RELEASE_COMMIT");
  const docsCommit = contract.status === "released" ? (envOrNull("EVIDENCE_DOCS_COMMIT") || git.commit) : envOrNull("EVIDENCE_DOCS_COMMIT");
  const remoteEvidence = {
    github: remoteEvidenceFor("GITHUB", releaseCommit, docsCommit),
    gitee: remoteEvidenceFor("GITEE", releaseCommit, docsCommit)
  };
  const artifact = {
    format: "time-isle-release-evidence-v1",
    generatedAt: new Date().toISOString(),
    status: contract.status,
    version: contract.version,
    schemaVersion: contract.schemaVersion,
    expectedTag: contract.tag,
    source: {
      commit: git.commit,
      releaseCommit,
      docsCommit,
      dirty: git.dirty,
      exactTags: git.exactTags,
      annotatedTagPresent: git.annotatedTags.includes(contract.tag),
      tagPeeledCommit: gitTagCommit(contract.tag) || null,
      tagObjectType: git.tagObjectTypes[contract.tag] || null,
      runtimeIsAncestorOfDocs: releaseCommit && docsCommit ? isAncestor(releaseCommit, docsCommit) : null
    },
    model: {
      id: contract.model.id,
      dtype: contract.model.dtype,
      dimensions: contract.model.dimensions,
      onnxSha256: onnx.sha256,
      onnxBytes: onnx.bytes
    },
    semanticEvaluation: {
      fixtureSha256: sha256File(evaluationFixturePath),
      qualityDocuments: contract.semanticEvaluation.qualityDocuments,
      performanceDocuments: contract.semanticEvaluation.performanceDocuments,
      maximumRegressionRatio: contract.semanticEvaluation.maximumRegressionRatio,
      detailedReportArtifact: "semantic-recall-evidence.json"
    },
    claims: contract.claims,
    gates: contract.requiredGates.map((gate) => evidenceGate(gate)),
    repositories: {
      github: { url: contract.repositories.github, ...remoteEvidence.github },
      gitee: { url: contract.repositories.gitee, ...remoteEvidence.gitee },
      sameCommitVerified: Boolean(
        releaseCommit && docsCommit &&
        remoteEvidence.github.mainCommit === docsCommit && remoteEvidence.gitee.mainCommit === docsCommit &&
        remoteEvidence.github.tagCommit === releaseCommit && remoteEvidence.gitee.tagCommit === releaseCommit &&
        remoteEvidence.github.tagAnnotated === true && remoteEvidence.gitee.tagAnnotated === true
      )
    },
    productionVerification: {
      ...contract.productionVerification,
      observedVersion: envOrFallback("EVIDENCE_PRODUCTION_VERSION", contract.productionVerification.observedVersion),
      observedSchemaVersion: envNumberOrFallback("EVIDENCE_PRODUCTION_SCHEMA_VERSION", contract.productionVerification.observedSchemaVersion),
      observedReleaseCommit: envOrFallback("EVIDENCE_PRODUCTION_RELEASE_COMMIT", contract.productionVerification.observedReleaseCommit),
      manifestPath: envOrFallback("EVIDENCE_PRODUCTION_MANIFEST_PATH", contract.productionVerification.manifestPath),
      manifestSha256: envOrFallback("EVIDENCE_PRODUCTION_MANIFEST_SHA256", contract.productionVerification.manifestSha256),
      deployments: envJsonOrFallback("EVIDENCE_PRODUCTION_DEPLOYMENTS", contract.productionVerification.deployments),
      probes: envJsonOrFallback("EVIDENCE_PRODUCTION_PROBES", contract.productionVerification.probes)
    },
    workflow: {
      runUrl: envOrNull("GITHUB_RUN_URL"),
      runner: envOrNull("RUNNER_NAME"),
      event: envOrNull("GITHUB_EVENT_NAME")
    }
  };
  const completenessFailures = validateReleaseEvidenceManifest(artifact, contract);
  artifact.completeness = completenessFailures.length ? (contract.status === "released" ? "incomplete" : "candidate") : "complete";
  if (process.argv.includes("--require-complete-evidence")) {
    for (const failure of completenessFailures) failures.push(failure);
    if (failures.length) return "";
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return targetPath;
}

function evidenceGate(gate) {
  const envName = `EVIDENCE_${gate.id.replace(/-/gu, "_").toUpperCase()}`;
  return { ...gate, result: String(process.env[envName] || "not-recorded") };
}

function inspectGit() {
  const commit = gitOutput(["rev-parse", "HEAD"]) || "unavailable";
  const dirty = Boolean(gitOutput(["status", "--porcelain", "--untracked-files=all"]));
  const exactTags = splitLines(gitOutput(["tag", "--points-at", "HEAD"]));
  const annotatedTags = exactTags.filter((tag) => gitOutput(["cat-file", "-t", tag]) === "tag");
  const tagObjectTypes = {};
  for (const tag of [contract.tag, ...exactTags]) tagObjectTypes[tag] = gitOutput(["cat-file", "-t", `refs/tags/${tag}`]);
  return { commit, dirty, exactTags, annotatedTags, tagObjectTypes };
}

function gitTagCommit(tag) {
  return gitOutput(["rev-parse", `refs/tags/${tag}^{commit}`]);
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function splitLines(value) { return String(value || "").split(/\r?\n/u).map((item) => item.trim()).filter(Boolean); }
function envOrNull(name) { return process.env[name] ? String(process.env[name]) : null; }
function envOrFallback(name, fallback) { return envOrNull(name) ?? fallback ?? null; }
function envNumberOrNull(name) {
  const value = envOrNull(name);
  return value !== null && /^\d+$/u.test(value) ? Number(value) : null;
}
function envNumberOrFallback(name, fallback) {
  const value = envNumberOrNull(name);
  return value === null ? (fallback ?? null) : value;
}
function envJsonOrNull(name) {
  const value = envOrNull(name);
  if (value === null) return null;
  try { return JSON.parse(value); } catch { return null; }
}
function envJsonOrFallback(name, fallback) {
  const value = envJsonOrNull(name);
  return value === null ? (fallback ?? null) : value;
}
function envBoolean(name) {
  const value = envOrNull(name);
  return value === null ? null : value.toLowerCase() === "true";
}
function remoteEvidenceFor(prefix, releaseCommit, docsCommit) {
  return {
    mainCommit: envOrNull(`EVIDENCE_${prefix}_MAIN_COMMIT`),
    tagCommit: envOrNull(`EVIDENCE_${prefix}_TAG_COMMIT`),
    tagAnnotated: envBoolean(`EVIDENCE_${prefix}_TAG_ANNOTATED`),
    expectedMainCommit: docsCommit,
    expectedTagCommit: releaseCommit
  };
}
function isAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root, windowsHide: true });
  return result.status === 0;
}
function readText(filePath) { return fs.readFileSync(filePath, "utf8"); }
function readJson(filePath) { return JSON.parse(readText(filePath)); }
function sha256File(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function check(condition, message) { if (!condition) failures.push(message); }
