"use strict";

const assert = require("node:assert/strict");
const { createRuntimeTrust } = require("../lib/runtime-trust");
const { createAiTrustService, digestInput } = require("../lib/ai-trust");

let clock = 1_800_000_000_000;
const runtimeTrust = createRuntimeTrust({
  appVersion: "17.1.2",
  schemaVersion: 19,
  interviewDemo: false,
  aiEnabled: true,
  environment: { AI_BASE_URL: "https://example.invalid/v1", AI_MODEL: "fixture-model", AI_PROVIDER_LABEL: "Fixture" },
  deployment: { publicDeployment: false },
  semanticModelId: "Xenova/bge-small-zh-v1.5"
});
const serviceOptions = {
  runtimeTrust,
  secret: Buffer.alloc(32, 7),
  now: () => clock,
  maxAgeMs: 60_000,
  consentMaxAgeMs: 60_000
};
const service = createAiTrustService(serviceOptions);
const input = "完全虚构的整理原文";
const issuedConsent = issueConsent(service, runtimeTrust.contractId, "organize", input);
const consentBody = { allowExternalAi: true, externalAiConsent: issuedConsent };

assert.equal(issuedConsent.contractId, runtimeTrust.contractId);
assert.equal(issuedConsent.inputSha256, digestInput("organize", input));
assert.equal(service.consumeExplicitConsent({ ...consentBody, allowExternalAi: "true" }, "organize", input), false);
assert.equal(service.consumeExplicitConsent(consentBody, "organize", input), true);
assert.throws(
  () => service.consumeExplicitConsent(consentBody, "organize", input),
  (error) => error.code === "AI_CONSENT_REPLAYED"
);

for (const [label, body, feature, changedInput] of [
  ["contract", { allowExternalAi: true, externalAiConsent: { ...issueConsent(service, runtimeTrust.contractId, "organize", input), contractId: `sha256:${"0".repeat(64)}` } }, "organize", input],
  ["feature", { allowExternalAi: true, externalAiConsent: issueConsent(service, runtimeTrust.contractId, "organize", input) }, "guide", input],
  ["input", { allowExternalAi: true, externalAiConsent: issueConsent(service, runtimeTrust.contractId, "organize", input) }, "organize", `${input}变化`],
  ["signature", { allowExternalAi: true, externalAiConsent: { ...issueConsent(service, runtimeTrust.contractId, "organize", input), signature: "0".repeat(64) } }, "organize", input]
]) {
  assert.throws(
    () => service.consumeExplicitConsent(body, feature, changedInput),
    (error) => error.code === "AI_CONSENT_INVALID",
    label
  );
}

const expiringConsent = issueConsent(service, runtimeTrust.contractId, "organize", input);
clock += 60_001;
assert.throws(
  () => service.consumeExplicitConsent({ allowExternalAi: true, externalAiConsent: expiringConsent }, "organize", input),
  (error) => error.code === "AI_CONSENT_INVALID"
);

const publicDemoTrust = createRuntimeTrust({
  appVersion: "17.1.2",
  schemaVersion: 19,
  interviewDemo: true,
  aiEnabled: true,
  environment: { AI_BASE_URL: "https://example.invalid/v1", AI_MODEL: "fixture-model" },
  deployment: { publicDeployment: true },
  semanticModelId: "Xenova/bge-small-zh-v1.5"
});
const publicDemoService = createAiTrustService({ runtimeTrust: publicDemoTrust, secret: Buffer.alloc(32, 8), now: () => clock });
assert.throws(
  () => issueConsent(publicDemoService, publicDemoTrust.contractId, "organize", input),
  (error) => error.code === "AI_CONSENT_UNAVAILABLE"
);

const execution = { engineId: "local-memory-rules-v1", mode: "local-rules", externalRequestOccurred: false, provider: null, model: null, consentApplied: false };
const receipt = service.createExecutionReceipt({ feature: "organize", memoryId: "memory-fixture", input, execution });
assert.deepEqual(service.verifyExecutionReceipt(receipt, { feature: "organize", memoryId: "memory-fixture", input }), execution);
for (const [label, changed, context] of [
  ["signature", { ...receipt, signature: "0".repeat(64) }, { feature: "organize", memoryId: "memory-fixture", input }],
  ["execution", { ...receipt, execution: { ...receipt.execution, mode: "external-model" } }, { feature: "organize", memoryId: "memory-fixture", input }],
  ["memory", receipt, { feature: "organize", memoryId: "memory-other", input }],
  ["input", receipt, { feature: "organize", memoryId: "memory-fixture", input: `${input}变化` }]
]) {
  assert.throws(() => service.verifyExecutionReceipt(changed, context), (error) => error.code === "AI_EXECUTION_RECEIPT_INVALID", label);
}
clock += 60_001;
assert.throws(() => service.verifyExecutionReceipt(receipt, { feature: "organize", memoryId: "memory-fixture", input }), (error) => error.code === "AI_EXECUTION_RECEIPT_INVALID");

console.log("AI trust checks passed: one-time content-bound consent and signed execution receipts.");

function issueConsent(targetService, contractId, feature, value) {
  return targetService.createExternalConsent({
    acknowledged: true,
    contractId,
    feature,
    inputSha256: digestInput(feature, value)
  });
}
