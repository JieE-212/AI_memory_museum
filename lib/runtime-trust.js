"use strict";

const crypto = require("node:crypto");

const TRUST_CONTRACT_VERSION = 1;

function createRuntimeTrust(options = {}) {
  const interviewDemo = Boolean(options.interviewDemo);
  const aiEnabled = Boolean(options.aiEnabled);
  const environment = options.environment || process.env;
  const deployment = options.deployment || {};
  const model = String(environment.AI_MODEL || "gpt-4.1-mini").trim().slice(0, 160);
  const endpointOrigin = safeEndpointOrigin(environment.AI_BASE_URL || "https://api.openai.com/v1");
  const providerLabel = safeProviderLabel(environment.AI_PROVIDER_LABEL, endpointOrigin);
  const deploymentKind = resolveDeploymentKind(environment, deployment);

  const trust = {
    contractVersion: TRUST_CONTRACT_VERSION,
    appVersion: String(options.appVersion || ""),
    schemaVersion: Number(options.schemaVersion) || 0,
    audience: interviewDemo ? "public-demo" : "private-local",
    deployment: {
      kind: deploymentKind,
      public: Boolean(deployment.publicDeployment),
      tenancy: interviewDemo ? "shared-anonymous-read-only" : "single-owner-device"
    },
    storage: {
      kind: "sqlite-and-content-addressed-media",
      scope: interviewDemo ? "shared-instance-fixtures" : "local-device",
      durability: interviewDemo ? "ephemeral" : "persistent",
      visitorWritesAllowed: !interviewDemo,
      writePolicy: interviewDemo ? "read-only-http" : "owner-writable",
      blockedMethods: interviewDemo ? ["POST", "PUT", "PATCH", "DELETE"] : [],
      blockedBeforeBodyRead: interviewDemo,
      resetTriggers: interviewDemo ? ["cold-start", "scale-to-zero", "redeploy"] : []
    },
    externalAi: {
      configured: aiEnabled,
      allowed: aiEnabled && !interviewDemo,
      consentRequired: true,
      providerLabel: aiEnabled ? providerLabel : null,
      endpointOrigin: aiEnabled ? endpointOrigin : null,
      protocol: "openai-compatible-chat-completions",
      model: aiEnabled ? model : null,
      retentionPolicy: "provider-dependent"
    },
    encryptionAtRest: {
      enabled: false,
      label: "未做静态加密",
      boundary: "应用锁馆不是 SQLite、媒体目录或磁盘静态加密"
    },
    features: {
      organize: feature({
        engineId: aiEnabled ? "consent-gated-openai-compatible-or-local-rules" : "local-memory-rules-v1",
        effectiveMode: aiEnabled ? "local-rules-until-consented" : "local-rules",
        executionLocation: aiEnabled ? "server-local-or-external-api" : "server-local",
        externalModel: aiEnabled,
        providerLabel: aiEnabled ? providerLabel : null,
        model: aiEnabled ? model : null,
        inputFieldsSent: aiEnabled ? ["rawContent"] : [],
        persistsOnPreview: false,
        persistsOnFinalSave: !interviewDemo,
        persistedFields: ["confirmed-draft", "execution-receipt"]
      }),
      guide: feature({
        engineId: aiEnabled ? "consent-gated-openai-compatible-or-local-guide" : "local-evidence-guide-v1",
        effectiveMode: interviewDemo ? "public-fixture-question-local-rules" : aiEnabled ? "local-rules-until-consented" : "local-rules",
        executionLocation: aiEnabled ? "server-local-or-external-api" : "server-local",
        externalModel: aiEnabled,
        providerLabel: aiEnabled ? providerLabel : null,
        model: aiEnabled ? model : null,
        inputFieldsSent: aiEnabled ? ["question", "evidence.title", "evidence.date", "evidence.hall", "evidence.exhibitText", "evidence.tags"] : [],
        persistsOnPreview: false,
        persistsOnFinalSave: false,
        persistedFields: []
      }),
      semanticRecall: feature({
        engineId: String(options.semanticModelId || "device-embedding"),
        effectiveMode: "device-embedding",
        executionLocation: "browser-worker",
        externalModel: false,
        model: String(options.semanticModelId || ""),
        inputFieldsSent: [],
        persistsOnPreview: false,
        persistsOnFinalSave: !interviewDemo,
        persistedFields: interviewDemo ? [] : ["source-hash", "float32le-vector-blob"]
      }),
      curatorWorkflow: feature({
        engineId: "local-evidence-rules-v1",
        effectiveMode: interviewDemo ? "public-synthetic-sample" : "deterministic-curation-workflow",
        executionLocation: "server-local",
        externalModel: false,
        model: null,
        inputFieldsSent: [],
        persistsOnPreview: !interviewDemo,
        persistsOnFinalSave: !interviewDemo,
        persistedFields: ["tool-receipts", "source-snapshot", "proposal", "human-decisions"]
      })
    },
    pwa: {
      responsiveWeb: true,
      nativeApp: false,
      shellOnly: true,
      privateDataCached: false,
      localServiceRequiredForPrivateCollection: true
    }
  };
  const consentContract = {
    contractVersion: trust.contractVersion,
    audience: trust.audience,
    deployment: trust.deployment.kind,
    externalAi: trust.externalAi,
    features: {
      organize: trust.features.organize.inputFieldsSent,
      guide: trust.features.guide.inputFieldsSent
    }
  };
  return Object.freeze({
    ...trust,
    contractId: `sha256:${crypto.createHash("sha256").update(canonicalize(consentContract)).digest("hex")}`
  });
}

function feature(value) {
  return Object.freeze({
    ...value,
    providerLabel: value.providerLabel || null,
    storageScope: value.persistsOnPreview || value.persistsOnFinalSave ? "application-storage" : "none"
  });
}

function safeEndpointOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function safeProviderLabel(value, endpointOrigin) {
  const explicit = String(value || "").trim().replace(/[\r\n\t]/gu, " ").slice(0, 80);
  if (explicit) return explicit;
  try {
    return new URL(endpointOrigin).hostname.slice(0, 80);
  } catch {
    return "OpenAI-compatible provider";
  }
}

function resolveDeploymentKind(environment, deployment) {
  const explicit = String(environment.DEPLOYMENT_PLATFORM || "").trim().toLowerCase();
  if (["cloudbase", "vercel", "local", "public-container"].includes(explicit)) return explicit;
  if (deployment.isVercelRuntime || environment.VERCEL) return "vercel";
  const hosts = String(environment.ALLOWED_HOSTS || "").toLowerCase();
  if (hosts.includes("tcloudbase.com") || hosts.includes("cloudbase")) return "cloudbase";
  return deployment.publicDeployment ? "public-container" : "local";
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

module.exports = {
  TRUST_CONTRACT_VERSION,
  createRuntimeTrust,
  resolveDeploymentKind,
  safeEndpointOrigin
};
