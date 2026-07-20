"use strict";

const { randomUUID } = require("node:crypto");

const DEFAULT_RETENTION_MS = 10 * 60 * 1000;
const MAX_RETENTION_MS = DEFAULT_RETENTION_MS;
const DEFAULT_MAX_ISSUES = 200;
const MAX_ISSUES = 200;
const TERMINAL_STATES = new Set(["completed", "cancelled", "failed"]);
const ISSUE_AREAS = new Set(["database", "media", "voice", "curation", "system"]);
const ISSUE_SEVERITIES = new Set(["attention", "error"]);
const MEDIA_VARIANT_KINDS = new Set(["original", "display", "thumb"]);
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,119}$/u;
const SHA256 = /^[a-f0-9]{64}$/iu;
const SAFE_COUNT_KEYS = new Set([
  "memories", "mediaAssets", "voiceAssets", "exhibitions", "capsules", "entities",
  "revisions", "timeCalibrations", "oralHistoryQuestions", "oralHistoryAnswers",
  "confirmedOralHistoryAnswers", "searchDocuments", "curatorAgentRuns", "curatorAgentSteps",
  "curatorAgentProposals", "curatorAgentDecisions", "curatorAgentCompleted",
  "curatorAgentInterrupted", "curatorAgentNeedsReview", "memoryInboxSources",
  "memoryInboxItems", "memoryInboxPending", "memoryInboxAccepted", "memoryInboxNeedsReview",
  "provenanceClaims", "provenanceSources", "provenanceEvents", "provenanceConfirmed", "provenanceNeedsReview",
  "coMemoryResponses", "coMemoryUnverifiedIdentity", "coMemoryEncryptedTransport", "coMemoryUnsigned"
]);

const ISSUE_MESSAGES = Object.freeze({
  DATABASE_CURATOR_AGENT_STRUCTURE: "策展助手的运行、步骤、提案或人工决定结构需要核对。",
  DATABASE_MEMORY_INBOX_STRUCTURE: "记忆收件箱的来源回执、精确区间或关联结构需要核对。",
  DATABASE_PROVENANCE_STRUCTURE: "来源护照的人工主张、来源快照或事件链结构需要核对。",
  DATABASE_CO_MEMORY_RESPONSE_STRUCTURE: "共忆回信的加密绑定、未核验身份边界或独立来源结构需要核对。",
  PROVENANCE_CLAIM_NEEDS_REVIEW: "一条已确认主张的来源发生变化，需要重新核对；原记忆不会被改写。",
  MEMORY_INBOX_PENDING: "一段文档摘录仍在收件箱等待人工决定。",
  MEMORY_INBOX_NEEDS_REVIEW: "一段文档来源回执需要重新核对。",
  CURATOR_AGENT_RUN_INTERRUPTED: "一项策展助手运行被中断，可以人工决定是否重新开始。",
  CURATOR_AGENT_RUN_NEEDS_REVIEW: "一项策展助手提案的来源已变化，需要人工复核。",
  DATABASE_CHECK_FAILED: "数据库完整性检查未通过。",
  DATABASE_QUICK_CHECK: "SQLite 快速完整性检查未通过。",
  DATABASE_FOREIGN_KEYS: "数据库存在无效引用。",
  DATABASE_SCHEMA: "数据库结构版本需要核对。",
  DATABASE_TIME_CALIBRATION_STRUCTURE: "时间校准记录的目标、范围或来源摘要结构需要核对。",
  DATABASE_ORAL_HISTORY_STRUCTURE: "口述史的问题、回答、声音片段或来源结构需要核对。",
  DATABASE_REVIEW_ITEM: "数据库中有一项内容需要核对。",
  CURATION_REVIEW_ITEM: "一项策展内容需要人工复核。",
  TIME_CALIBRATION_NEEDS_REVIEW: "一项时间校准的来源已经变化，需要重新核对。",
  ORAL_HISTORY_ANSWER_DRAFT: "一段口述回答仍是草稿，确认后才会成为时间来源。",
  ORAL_HISTORY_QUESTION_OPEN: "一个口述问题还没有人工确认的回答。",
  MEDIA_ASSET_INVALID: "一项图片资产记录无效。",
  MEDIA_ASSET_STATUS_REVIEW: "一项图片资产尚未处于可用状态。",
  MEDIA_PRIVACY_MODE_INVALID: "一项图片资产的隐私策略无效。",
  MEDIA_VARIANTS_INVALID: "一项图片资产缺少必需的安全版本。",
  MEDIA_VARIANT_DUPLICATE: "一项图片资产包含重复版本。",
  MEDIA_VARIANT_UNEXPECTED_ORIGINAL: "仅保留安全展示图的资产仍引用原图版本。",
  MEDIA_CONTENT_ANCHOR_MISMATCH: "一项图片资产的内容锚点不一致。",
  MEDIA_VARIANT_INTEGRITY_FAILED: "一项图片文件未通过完整性核验。",
  VOICE_ASSET_INVALID: "一项声音资产记录无效。",
  VOICE_ASSET_STATUS_REVIEW: "一项声音资产尚未处于可用状态。",
  VOICE_ASSET_INTEGRITY_FAILED: "一项声音文件未通过完整性核验。",
  COLLECTION_HEALTH_SCAN_FAILED: "本次馆藏体检未能完整执行。"
});

function createCollectionHealthService(options = {}) {
  assertPlainObject(options, "options");
  const getDatabaseSnapshot = dependencyFunction(
    options.getDatabaseHealthSnapshot || options.database?.snapshot,
    "getDatabaseHealthSnapshot"
  );
  const media = normalizeMediaDependency(options.media);
  const voice = normalizeVoiceDependency(options.voice);
  const runExclusive = options.runExclusive === undefined
    ? (operation) => operation()
    : dependencyFunction(options.runExclusive, "runExclusive");
  const now = options.now === undefined ? () => Date.now() : dependencyFunction(options.now, "now");
  const createId = options.createId === undefined
    ? () => `health-${randomUUID()}`
    : dependencyFunction(options.createId, "createId");
  const retentionMs = boundedInteger(options.retentionMs, 1, MAX_RETENTION_MS, DEFAULT_RETENTION_MS);
  const maxIssues = boundedInteger(options.maxIssues, 1, MAX_ISSUES, DEFAULT_MAX_ISSUES);

  const scans = new Map();
  let activeScanId = "";
  let destroyed = false;

  function start(input = {}) {
    assertAvailable();
    assertPlainObject(input, "input");
    assertKnownKeys(input, new Set(["scope"]), "input");
    pruneExpired();
    const scope = input.scope === undefined ? "full" : String(input.scope);
    if (scope !== "full") throw healthError("馆藏体检首版只支持 full 范围。", "COLLECTION_HEALTH_SCOPE_INVALID", 400);
    const active = activeScanId ? scans.get(activeScanId) : null;
    if (active && !TERMINAL_STATES.has(active.state)) {
      throw healthError("已有一项馆藏体检正在运行。", "COLLECTION_HEALTH_SCAN_BUSY", 409);
    }

    const startedAtMs = validNow(now());
    const id = normalizeScanId(createId());
    if (scans.has(id)) throw healthError("馆藏体检 ID 冲突。", "COLLECTION_HEALTH_ID_CONFLICT", 500);
    const scan = {
      id,
      scope,
      state: "running",
      startedAtMs,
      completedAtMs: null,
      expiresAtMs: null,
      progress: { phase: "queued", checked: 0, total: 0 },
      sections: emptySections(),
      collector: createIssueCollector(maxIssues),
      controller: new AbortController(),
      expiryTimer: null,
      promise: null
    };
    scans.set(id, scan);
    activeScanId = id;
    scan.promise = Promise.resolve()
      .then(() => runExclusive(() => runScan(scan), { signal: scan.controller.signal }))
      .then(() => completeScan(scan))
      .catch((error) => failOrCancelScan(scan, error))
      .finally(() => {
        if (activeScanId === scan.id) activeScanId = "";
        if (!destroyed) scheduleExpiry(scan);
      });
    return publicScan(scan);
  }

  function get(id) {
    assertAvailable();
    pruneExpired();
    const scan = scans.get(normalizeScanId(id));
    return scan ? publicScan(scan) : null;
  }

  function cancel(id) {
    assertAvailable();
    pruneExpired();
    const scan = scans.get(normalizeScanId(id));
    if (!scan) return null;
    if (!TERMINAL_STATES.has(scan.state)) {
      scan.state = "cancelling";
      scan.progress.phase = "cancelling";
      scan.controller.abort(abortError());
    }
    return publicScan(scan);
  }

  async function wait(id) {
    assertAvailable();
    const scan = scans.get(normalizeScanId(id));
    if (!scan) return null;
    await scan.promise;
    return scans.has(scan.id) ? publicScan(scan) : null;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const scan of scans.values()) {
      if (!TERMINAL_STATES.has(scan.state)) scan.controller.abort(abortError());
      if (scan.expiryTimer) clearTimeout(scan.expiryTimer);
    }
    scans.clear();
    activeScanId = "";
  }

  async function runScan(scan) {
    const { signal } = scan.controller;
    throwIfAborted(signal);
    scan.progress.phase = "database";
    scan.progress.total = 1;
    const databaseSnapshot = await getDatabaseSnapshot({ signal });
    throwIfAborted(signal);
    scan.sections.database = inspectDatabaseSnapshot(databaseSnapshot, scan.collector);
    scan.progress.checked = 1;

    scan.progress.phase = "inventory";
    const mediaAssets = normalizeAssetList(await media.listAssets({ signal }), "media");
    throwIfAborted(signal);
    const voiceAssets = normalizeAssetList(await voice.listAssets({ signal }), "voice");
    throwIfAborted(signal);
    scan.progress.total = 1 + mediaAssets.length + voiceAssets.length;

    scan.progress.phase = "media";
    scan.sections.media = await inspectMediaAssets(mediaAssets, media.verifyVariant, scan.collector, signal, () => {
      scan.progress.checked += 1;
    });
    throwIfAborted(signal);

    scan.progress.phase = "voice";
    scan.sections.voice = await inspectVoiceAssets(voiceAssets, voice.verifyAsset, scan.collector, signal, () => {
      scan.progress.checked += 1;
    });
    throwIfAborted(signal);
  }

  function completeScan(scan) {
    if (scan.controller.signal.aborted) return failOrCancelScan(scan, abortError());
    scan.state = "completed";
    scan.progress.phase = "done";
    scan.progress.checked = scan.progress.total;
    scan.completedAtMs = validNow(now());
  }

  function failOrCancelScan(scan, error) {
    if (scan.controller.signal.aborted || error?.name === "AbortError") {
      scan.state = "cancelled";
      scan.progress.phase = "cancelled";
    } else {
      scan.state = "failed";
      scan.progress.phase = "failed";
      scan.collector.add({ code: "COLLECTION_HEALTH_SCAN_FAILED", severity: "error", area: "system" });
    }
    scan.completedAtMs = validNow(now());
  }

  function scheduleExpiry(scan) {
    if (!TERMINAL_STATES.has(scan.state) || scan.expiryTimer) return;
    scan.expiresAtMs = scan.completedAtMs + retentionMs;
    const delay = Math.max(1, scan.expiresAtMs - validNow(now()));
    scan.expiryTimer = setTimeout(() => {
      const current = scans.get(scan.id);
      if (current === scan && TERMINAL_STATES.has(scan.state)) scans.delete(scan.id);
    }, delay);
    scan.expiryTimer.unref?.();
  }

  function pruneExpired() {
    const current = validNow(now());
    for (const [id, scan] of scans) {
      if (scan.expiresAtMs !== null && current >= scan.expiresAtMs) {
        if (scan.expiryTimer) clearTimeout(scan.expiryTimer);
        scans.delete(id);
      }
    }
  }

  function assertAvailable() {
    if (destroyed) throw healthError("馆藏体检服务已经关闭。", "COLLECTION_HEALTH_SERVICE_CLOSED", 503);
  }

  return Object.freeze({ start, get, cancel, wait, destroy });
}

function inspectDatabaseSnapshot(snapshot, collector) {
  if (!isPlainObject(snapshot)) throw new TypeError("数据库健康快照必须是对象。");
  const checks = Array.isArray(snapshot.checks) ? snapshot.checks : [];
  let passed = 0;
  for (const check of checks) {
    if (!isPlainObject(check) || check.ok !== true) {
      collector.add({
        code: safeIssueCode(check?.code, "DATABASE_CHECK_FAILED"),
        severity: "error",
        area: check?.area === "curation" ? "curation" : "database",
        recordId: check?.recordId
      });
    } else {
      passed += 1;
    }
  }
  if (snapshot.ok === false && !checks.length) {
    collector.add({ code: "DATABASE_CHECK_FAILED", severity: "error", area: "database" });
  }
  const suppliedIssues = Array.isArray(snapshot.issues) ? snapshot.issues : [];
  for (const issue of suppliedIssues) {
    collector.add({
      code: safeIssueCode(issue?.code, issue?.area === "curation" ? "CURATION_REVIEW_ITEM" : "DATABASE_REVIEW_ITEM"),
      severity: issue?.severity,
      area: issue?.area === "curation" ? "curation" : "database",
      recordId: issue?.recordId
    });
  }
  const sampledCounts = new Map();
  suppliedIssues.forEach((issue) => {
    const key = `${safeIssueCode(issue?.code, "CURATION_REVIEW_ITEM")}\u0000${issue?.area === "curation" ? "curation" : "database"}`;
    sampledCounts.set(key, (sampledCounts.get(key) || 0) + 1);
  });
  const issueCounts = Array.isArray(snapshot.issueCounts) ? snapshot.issueCounts : [];
  for (const group of issueCounts) {
    const code = safeIssueCode(group?.code, group?.area === "curation" ? "CURATION_REVIEW_ITEM" : "DATABASE_REVIEW_ITEM");
    const area = group?.area === "curation" ? "curation" : "database";
    const count = Number.isSafeInteger(group?.count) && group.count > 0 ? group.count : 0;
    const sampled = sampledCounts.get(`${code}\u0000${area}`) || 0;
    collector.addMany({ code, severity: group?.severity, area }, Math.max(0, count - sampled));
  }
  return {
    status: sectionStatus(collector, "database"),
    checks: checks.length,
    passed,
    failed: checks.length - passed,
    records: sanitizeCounts(snapshot.counts)
  };
}

async function inspectMediaAssets(assets, verifyVariant, collector, signal, markChecked) {
  const summary = { status: "pass", assets: assets.length, ready: 0, variants: 0, bytes: 0 };
  for (const asset of assets) {
    throwIfAborted(signal);
    const recordId = safeRecordId(asset?.id);
    if (!isPlainObject(asset)) {
      collector.add({ code: "MEDIA_ASSET_INVALID", severity: "error", area: "media" });
      markChecked();
      continue;
    }
    const variants = Array.isArray(asset.variants) ? asset.variants : [];
    summary.variants += variants.length;
    summary.bytes = safeByteAdd(summary.bytes, variants.reduce((sum, variant) => safeByteAdd(sum, variant?.byteSize), 0));
    if (asset.status !== "ready") {
      collector.add({ code: "MEDIA_ASSET_STATUS_REVIEW", severity: "attention", area: "media", recordId });
      markChecked();
      continue;
    }
    summary.ready += 1;
    const required = requiredMediaKinds(asset.privacyMode, collector, recordId);
    const kinds = new Set();
    for (const variant of variants) {
      const kind = String(variant?.kind || "");
      if (!MEDIA_VARIANT_KINDS.has(kind)) {
        collector.add({ code: "MEDIA_VARIANTS_INVALID", severity: "error", area: "media", recordId });
        continue;
      }
      if (kinds.has(kind)) collector.add({ code: "MEDIA_VARIANT_DUPLICATE", severity: "error", area: "media", recordId, variantKind: kind });
      kinds.add(kind);
    }
    if (required && [...required].some((kind) => !kinds.has(kind))) {
      collector.add({ code: "MEDIA_VARIANTS_INVALID", severity: "error", area: "media", recordId });
    }
    if (asset.privacyMode === "sanitized_only" && kinds.has("original")) {
      collector.add({ code: "MEDIA_VARIANT_UNEXPECTED_ORIGINAL", severity: "error", area: "media", recordId, variantKind: "original" });
    }
    const anchorKind = asset.privacyMode === "preserve_original" ? "original" : "display";
    const anchor = variants.find((variant) => variant?.kind === anchorKind);
    if (anchor && asset.contentSha256 !== anchor.sha256) {
      collector.add({ code: "MEDIA_CONTENT_ANCHOR_MISMATCH", severity: "error", area: "media", recordId, variantKind: anchorKind });
    }
    for (const variant of variants) {
      throwIfAborted(signal);
      const kind = MEDIA_VARIANT_KINDS.has(String(variant?.kind || "")) ? String(variant.kind) : undefined;
      let verified = false;
      try {
        const result = await verifyVariant(variant, { asset, signal });
        verified = result === true || result?.ok === true;
      } catch (error) {
        if (signal.aborted || error?.name === "AbortError") throw abortError();
      }
      if (!verified) {
        collector.add({ code: "MEDIA_VARIANT_INTEGRITY_FAILED", severity: "error", area: "media", recordId, variantKind: kind });
      }
    }
    markChecked();
  }
  summary.status = sectionStatus(collector, "media");
  return summary;
}

async function inspectVoiceAssets(assets, verifyAsset, collector, signal, markChecked) {
  const summary = { status: "pass", assets: assets.length, ready: 0, bytes: 0 };
  for (const asset of assets) {
    throwIfAborted(signal);
    const recordId = safeRecordId(asset?.id);
    if (!isPlainObject(asset)) {
      collector.add({ code: "VOICE_ASSET_INVALID", severity: "error", area: "voice" });
      markChecked();
      continue;
    }
    summary.bytes = safeByteAdd(summary.bytes, asset.byteSize);
    if (asset.status !== "ready") {
      collector.add({ code: "VOICE_ASSET_STATUS_REVIEW", severity: "attention", area: "voice", recordId });
      markChecked();
      continue;
    }
    summary.ready += 1;
    let verified = false;
    try {
      const result = await verifyAsset(asset, { signal });
      verified = result === true || result?.ok === true;
    } catch (error) {
      if (signal.aborted || error?.name === "AbortError") throw abortError();
    }
    if (!verified) collector.add({ code: "VOICE_ASSET_INTEGRITY_FAILED", severity: "error", area: "voice", recordId });
    markChecked();
  }
  summary.status = sectionStatus(collector, "voice");
  return summary;
}

function publicScan(scan) {
  const terminal = TERMINAL_STATES.has(scan.state);
  const snapshot = {
    id: scan.id,
    state: scan.state,
    scope: scan.scope,
    startedAt: new Date(scan.startedAtMs).toISOString(),
    completedAt: scan.completedAtMs === null ? null : new Date(scan.completedAtMs).toISOString(),
    expiresAt: scan.expiresAtMs === null ? null : new Date(scan.expiresAtMs).toISOString(),
    progress: { ...scan.progress }
  };
  if (terminal) {
    const collector = scan.collector.snapshot();
    snapshot.summary = {
      status: scan.state === "completed"
        ? (collector.bySeverity.error ? "blocker" : collector.total ? "attention" : "healthy")
        : "incomplete",
      database: cloneSection(scan.sections.database),
      media: cloneSection(scan.sections.media),
      voices: cloneSection(scan.sections.voice),
      curation: {
        status: sectionStatus(scan.collector, "curation"),
        needsReview: collector.byArea.curation || 0
      },
      issuesTotal: collector.total,
      issuesTruncated: collector.truncated
    };
    snapshot.issues = collector.issues.map((issue) => ({ ...issue }));
  }
  return snapshot;
}

function createIssueCollector(limit) {
  const issues = [];
  const byArea = { database: 0, media: 0, voice: 0, curation: 0, system: 0 };
  const bySeverity = { attention: 0, error: 0 };
  const errorByArea = { database: 0, media: 0, voice: 0, curation: 0, system: 0 };
  let total = 0;
  return Object.freeze({
    add(input) {
      const issue = sanitizeIssue(input);
      total += 1;
      byArea[issue.area] += 1;
      bySeverity[issue.severity] += 1;
      if (issue.severity === "error") errorByArea[issue.area] += 1;
      if (issues.length < limit) issues.push(issue);
    },
    addMany(input, count) {
      const amount = Number.isSafeInteger(count) && count > 0 ? count : 0;
      if (!amount) return;
      const issue = sanitizeIssue(input);
      total += amount;
      byArea[issue.area] += amount;
      bySeverity[issue.severity] += amount;
      if (issue.severity === "error") errorByArea[issue.area] += amount;
    },
    count(area) {
      return byArea[area] || 0;
    },
    hasSeverity(area, severity) {
      return severity === "error" ? Boolean(errorByArea[area]) : Boolean(byArea[area] - errorByArea[area]);
    },
    snapshot() {
      return {
        total,
        truncated: total > issues.length,
        issues: issues.map((issue) => ({ ...issue })),
        byArea: { ...byArea },
        bySeverity: { ...bySeverity }
      };
    }
  });
}

function sanitizeIssue(input = {}) {
  const area = ISSUE_AREAS.has(input.area) ? input.area : "system";
  const severity = ISSUE_SEVERITIES.has(input.severity) ? input.severity : "attention";
  const fallback = area === "curation" ? "CURATION_REVIEW_ITEM"
    : area === "database" ? "DATABASE_REVIEW_ITEM"
      : area === "media" ? "MEDIA_ASSET_INVALID"
        : area === "voice" ? "VOICE_ASSET_INVALID"
          : "COLLECTION_HEALTH_SCAN_FAILED";
  const code = safeIssueCode(input.code, fallback);
  return {
    code,
    severity,
    area,
    ...(safeRecordId(input.recordId) ? { recordId: safeRecordId(input.recordId) } : {}),
    ...(MEDIA_VARIANT_KINDS.has(input.variantKind) ? { variantKind: input.variantKind } : {}),
    message: ISSUE_MESSAGES[code] || ISSUE_MESSAGES[fallback],
    repairAction: null
  };
}

function requiredMediaKinds(privacyMode, collector, recordId) {
  if (privacyMode === "sanitized_only") return new Set(["display", "thumb"]);
  if (privacyMode === "preserve_original") return new Set(["original", "display", "thumb"]);
  collector.add({ code: "MEDIA_PRIVACY_MODE_INVALID", severity: "error", area: "media", recordId });
  return null;
}

function normalizeMediaDependency(value) {
  if (!isPlainObject(value)) throw new TypeError("media 必须是对象。");
  return Object.freeze({
    listAssets: dependencyFunction(value.listAssets || value.listAllAssets, "media.listAssets"),
    verifyVariant: dependencyFunction(value.verifyVariant, "media.verifyVariant")
  });
}

function normalizeVoiceDependency(value) {
  if (!isPlainObject(value)) throw new TypeError("voice 必须是对象。");
  return Object.freeze({
    listAssets: dependencyFunction(value.listAssets || value.listAllAssets, "voice.listAssets"),
    verifyAsset: dependencyFunction(value.verifyAsset || value.verify, "voice.verifyAsset")
  });
}

function normalizeAssetList(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label}.listAssets 必须返回数组。`);
  return value;
}

function emptySections() {
  return {
    database: { status: "pending", checks: 0, passed: 0, failed: 0, records: {} },
    media: { status: "pending", assets: 0, ready: 0, variants: 0, bytes: 0 },
    voice: { status: "pending", assets: 0, ready: 0, bytes: 0 }
  };
}

function cloneSection(value) {
  return { ...value, ...(value.records ? { records: { ...value.records } } : {}) };
}

function sectionStatus(collector, area) {
  if (collector.hasSeverity(area, "error")) return "blocker";
  return collector.count(area) ? "attention" : "pass";
}

function sanitizeCounts(value) {
  if (!isPlainObject(value)) return {};
  const output = {};
  for (const [key, count] of Object.entries(value)) {
    if (!SAFE_COUNT_KEYS.has(key)) continue;
    if (Number.isSafeInteger(count) && count >= 0) output[key] = count;
  }
  return output;
}

function safeByteAdd(left, right) {
  const value = Number(right);
  if (!Number.isSafeInteger(value) || value < 0) return left;
  const total = left + value;
  return Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER;
}

function safeRecordId(value) {
  const id = String(value || "");
  return SAFE_ID.test(id) && !SHA256.test(id) ? id : "";
}

function safeIssueCode(value, fallback) {
  const code = String(value || "");
  return /^[A-Z][A-Z0-9_]{2,79}$/u.test(code) && !SHA256.test(code) ? code : fallback;
}

function normalizeScanId(value) {
  const id = String(value || "");
  if (!SAFE_ID.test(id) || SHA256.test(id)) throw healthError("馆藏体检 ID 无效。", "COLLECTION_HEALTH_ID_INVALID", 400);
  return id;
}

function dependencyFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} 必须是函数。`);
  return value;
}

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`数值必须是至少 ${minimum} 的整数。`);
  return Math.min(number, maximum);
}

function validNow(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError("now() 必须返回有效毫秒时间。");
  return Math.floor(number);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function abortError() {
  const error = new Error("馆藏体检已取消。");
  error.name = "AbortError";
  error.code = "COLLECTION_HEALTH_SCAN_CANCELLED";
  return error;
}

function healthError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} 必须是对象。`);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertKnownKeys(value, allowed, name) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new TypeError(`${name} 包含未知字段：${unexpected.join(", ")}。`);
}

module.exports = {
  createCollectionHealthService,
  DEFAULT_RETENTION_MS,
  DEFAULT_MAX_ISSUES,
  MAX_ISSUES
};
