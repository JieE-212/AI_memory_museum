"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateReleaseContractState, validateReleaseGitTopology, validateReleaseEvidenceManifest } = require("../lib/release-contract");

const candidate = {
  status: "candidate-local-only",
  tag: "v17.1.2",
  requiredGates: [
    { id: "root-linux" },
    { id: "root-windows" },
    { id: "browser" },
    { id: "semantic" },
    { id: "container" }
  ],
  productionVerification: {
    status: "pending-local-acceptance-and-deploy",
    requiredBeforeReleased: true
  }
};
assert.deepEqual(validateReleaseContractState(candidate), []);

const contaminatedCandidate = structuredClone(candidate);
contaminatedCandidate.release = { runtimeCommit: "a".repeat(40) };
contaminatedCandidate.productionVerification.observedVersion = "17.1.2";
assert.ok(validateReleaseContractState(contaminatedCandidate).length >= 2, "candidate rejects released evidence residue");

const runtimeCommit = "a".repeat(40);
const docsCommit = "b".repeat(40);
const released = {
  status: "released",
  version: "17.1.2",
  schemaVersion: 19,
  tag: "v17.1.2",
  requiredGates: candidate.requiredGates,
  release: {
    releaseCommit: runtimeCommit,
    tag: "v17.1.2",
    topologyEvidence: "post-docs-commit-manifest",
    tagAnnotated: true,
    tagPeeledCommit: runtimeCommit,
    releasedAt: "2026-08-10T12:00:00.000Z",
    ciRunUrl: "https://github.com/JieE-212/AI_memory_museum/actions/runs/123",
    preReleaseEvidence: { url: "https://github.com/JieE-212/AI_memory_museum/actions/runs/123", sha256: "d".repeat(64) },
  },
  productionVerification: {
    status: "verified",
    requiredBeforeReleased: true,
    observedVersion: "17.1.2",
    observedSchemaVersion: 19,
    observedReleaseCommit: runtimeCommit,
    verifiedAt: "2026-08-10T12:10:00.000Z",
    manifestKind: "pre-release-production-probe",
    manifestPath: "release/evidence/v17.1.2.json",
    manifestSha256: "c".repeat(64),
    deployments: {
      vercel: { id: "vercel-1", sourceCommit: runtimeCommit },
      cloudbase: { id: "cloudbase-1", sourceCommit: runtimeCommit },
      wakeup: { id: "wakeup-1", sourceCommit: runtimeCommit }
    },
    probes: [
      { id: "cloudbase-api", version: "17.1.2", schemaVersion: 19, deploymentCommit: runtimeCommit, visitorWritesAllowed: false, blockedBeforeBodyRead: true, externalAiAllowed: false, encryptionAtRest: false, zeroBodyWrites: true },
      { id: "vercel-api", version: "17.1.2", schemaVersion: 19, deploymentCommit: runtimeCommit, visitorWritesAllowed: false, blockedBeforeBodyRead: true, externalAiAllowed: false, encryptionAtRest: false, zeroBodyWrites: true }
    ]
  }
};
assert.deepEqual(validateReleaseContractState(released), []);

const completeManifest = {
  format: "time-isle-release-evidence-v1",
  generatedAt: "2026-08-10T12:20:00.000Z",
  status: "released",
  version: "17.1.2",
  schemaVersion: 19,
  expectedTag: "v17.1.2",
  source: {
    commit: docsCommit,
    releaseCommit: runtimeCommit,
    docsCommit,
    dirty: false,
    tagPeeledCommit: runtimeCommit,
    tagObjectType: "tag",
    runtimeIsAncestorOfDocs: true
  },
  gates: released.requiredGates.map((gate) => ({ ...gate, result: "success" })),
  repositories: {
    github: { mainCommit: docsCommit, tagCommit: runtimeCommit, tagAnnotated: true },
    gitee: { mainCommit: docsCommit, tagCommit: runtimeCommit, tagAnnotated: true },
    sameCommitVerified: true
  },
  productionVerification: released.productionVerification
};
assert.deepEqual(validateReleaseEvidenceManifest(completeManifest, released), [], "post-commit manifest binds B without self-reference");

const selfReferentialContract = structuredClone(released);
selfReferentialContract.release.docsCommit = docsCommit;
assert.match(validateReleaseContractState(selfReferentialContract).join("\n"), /self-referential/u);
const remoteSelfReference = structuredClone(released);
remoteSelfReference.release.remoteCommits = { github: { mainCommit: docsCommit } };
assert.match(validateReleaseContractState(remoteSelfReference).join("\n"), /self-referential/u);

const invalidReleased = structuredClone(released);
invalidReleased.productionVerification.deployments.vercel.sourceCommit = "c".repeat(40);
assert.match(validateReleaseContractState(invalidReleased).join("\n"), /bind vercel to release commit A/u);

for (const remote of ["github", "gitee"]) {
  const invalidRemote = structuredClone(completeManifest);
  invalidRemote.repositories[remote].tagCommit = docsCommit;
  assert.match(validateReleaseEvidenceManifest(invalidRemote, released).join("\n"), new RegExp(`bind ${remote} main`, "u"));
}

const invalidProbe = structuredClone(completeManifest);
invalidProbe.productionVerification.probes[0].zeroBodyWrites = false;
assert.match(validateReleaseEvidenceManifest(invalidProbe, released).join("\n"), /does not match the release trust boundary/u);

const invalidManifest = structuredClone(released);
invalidManifest.productionVerification.manifestSha256 = "not-a-sha";
assert.match(validateReleaseContractState(invalidManifest).join("\n"), /manifest and its SHA-256/u);

runGitTopologyRegressions();

console.log("Release contract state checks passed.");

function runGitTopologyRegressions() {
  const annotated = createTopologyRepo({ tagKind: "annotated", tagTarget: "runtime", docsPath: "README.md" });
  try {
    assert.deepEqual(validateReleaseGitTopology({ cwd: annotated.root, tag: "v17.1.2", runtimeCommit: annotated.runtime, docsCommit: annotated.docs }), [], "annotated tag at A with docs-only B passes");
    assert.match(validateReleaseGitTopology({ cwd: annotated.root, tag: "v17.1.2", runtimeCommit: annotated.runtime, docsCommit: annotated.runtime }).join("\n"), /HEAD must be documentation commit B/u, "HEAD must not be silently treated as an unrelated docs commit");
  } finally { cleanup(annotated.root); }

  for (const scenario of [
    { tagKind: "lightweight", tagTarget: "runtime", docsPath: "README.md", message: /annotated tag/u },
    { tagKind: "annotated", tagTarget: "docs", docsPath: "README.md", message: /peel to runtime/u },
    { tagKind: "annotated", tagTarget: "runtime", docsPath: "server.js", message: /documentation and release evidence only/u },
    { tagKind: "annotated", tagTarget: "runtime", docsPath: "README.md", unrelatedDocsCommit: true, message: /ancestor/u }
  ]) {
    const repo = createTopologyRepo(scenario);
    try {
      const failures = validateReleaseGitTopology({ cwd: repo.root, tag: "v17.1.2", runtimeCommit: repo.runtime, docsCommit: repo.docs });
      assert.match(failures.join("\n"), scenario.message, `topology regression ${scenario.message}`);
    } finally { cleanup(repo.root); }
  }
}

function createTopologyRepo({ tagKind, tagTarget, docsPath, unrelatedDocsCommit = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-release-topology-"));
  const run = (args) => {
    const result = spawnSync("git", ["-c", "user.name=Time Isle Test", "-c", "user.email=time-isle-test@example.invalid", ...args], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
    return String(result.stdout || "").trim();
  };
  run(["init", "--quiet"]);
  fs.writeFileSync(path.join(root, "server.js"), "runtime\n", "utf8");
  run(["add", "."]);
  run(["commit", "--quiet", "-m", "runtime A"]);
  const runtime = run(["rev-parse", "HEAD"]);
  if (tagTarget === "runtime") {
    if (tagKind === "annotated") run(["tag", "-a", "v17.1.2", "-m", "release", runtime]);
    else run(["tag", "v17.1.2", runtime]);
  }

  if (unrelatedDocsCommit) {
    run(["checkout", "--quiet", "--orphan", "docs"]);
    for (const item of fs.readdirSync(root)) if (item !== ".git") fs.rmSync(path.join(root, item), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(root, docsPath), "documentation B\n", "utf8");
  run(["add", "."]);
  run(["commit", "--quiet", "-m", "documentation B"]);
  const docs = run(["rev-parse", "HEAD"]);
  if (tagTarget === "docs") {
    if (tagKind === "annotated") run(["tag", "-a", "v17.1.2", "-m", "release", docs]);
    else run(["tag", "v17.1.2", docs]);
  }
  return { root, runtime, docs };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
