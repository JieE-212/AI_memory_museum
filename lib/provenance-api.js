"use strict";

const { catalogSourceToClaimSource } = require("./provenance-service");

const MEMORY_PATH = /^\/api\/provenance\/memories\/([a-zA-Z0-9_-]{1,120})(?:\/(sources|claims))?$/u;
const CLAIM_ACTION_PATH = /^\/api\/provenance\/claims\/([a-zA-Z0-9_-]{1,120})\/(confirm|withdraw)$/u;
const CREATE_KEYS = new Set(["confirm", "sources", "statement"]);
const SOURCE_KEYS = new Set(["anchorKey", "label", "locator", "relationKind", "sourceKey", "sourceKind"]);
const ACTION_KEYS = new Set(["confirm"]);
const RELATIONS = new Set(["supports", "supplements", "different_record"]);
const KINDS = new Set(["memory_text", "document_excerpt", "image_region", "voice_segment", "oral_history_excerpt", "co_memory_response"]);

function createProvenanceApi(options = {}) {
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const httpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  assertDependencies({ store, sendJson, readJsonBody, httpError });

  async function handle(request, response, url) {
    if (!url?.pathname.startsWith("/api/provenance")) return false;
    const memoryMatch = url.pathname.match(MEMORY_PATH);
    const actionMatch = url.pathname.match(CLAIM_ACTION_PATH);

    if (request.method === "GET" && memoryMatch) {
      assertNoQuery(url, httpError);
      const memoryId = memoryMatch[1];
      const resource = memoryMatch[2] || "passport";
      if (resource === "sources") {
        const sources = store.listProvenanceSources(memoryId).map(publicCandidate);
        return sendJson(response, 200, { memoryId, count: sources.length, sources, demo: interviewDemo });
      }
      if (resource === "claims") throw httpError(405, "主张只能通过明确的创建请求加入来源护照。");
      if (interviewDemo) return sendJson(response, 200, { passport: syntheticPassport(memoryId) });
      return sendJson(response, 200, { passport: publicPassport(store.getProvenancePassport(memoryId)) });
    }

    if (!["GET", "HEAD"].includes(request.method) && interviewDemo) {
      return sendJson(response, 403, {
        error: "公开 Demo 的来源护照保持只读；请求体不会被读取，也不会创建、确认或撤回主张。",
        code: "PROVENANCE_DEMO_READ_ONLY",
        interviewDemo: true
      });
    }

    if (request.method === "POST" && memoryMatch?.[2] === "claims") {
      assertNoQuery(url, httpError);
      const body = await readJsonBody(request);
      assertExactObject(body, CREATE_KEYS, "来源主张", httpError);
      if (body.confirm !== true) throw apiError(httpError, 400, "保存来源主张草稿前需要明确确认。", "PROVENANCE_CONFIRMATION_REQUIRED");
      if (!Array.isArray(body.sources) || body.sources.length < 1 || body.sources.length > 8) {
        throw apiError(httpError, 400, "一条主张必须选择 1 至 8 项可核对来源。", "PROVENANCE_SOURCE_COUNT_INVALID");
      }
      const candidates = store.listProvenanceSources(memoryMatch[1]);
      const sources = body.sources.map((selection, index) => resolveClientSource({
        store,
        memoryId: memoryMatch[1],
        selection,
        candidates,
        index,
        httpError
      }));
      const result = store.createProvenanceClaim({
        memoryId: memoryMatch[1],
        statement: body.statement,
        sources
      }, { idempotencyKey: requireIdempotencyKey(request, httpError) });
      response.setHeader("ETag", result.claim.etag);
      return sendJson(response, result.created ? 201 : 200, {
        created: Boolean(result.created),
        idempotent: Boolean(result.idempotent),
        claim: publicClaim(result.claim)
      });
    }

    if (request.method === "POST" && actionMatch) {
      assertNoQuery(url, httpError);
      const claim = store.getProvenanceClaim(actionMatch[1]);
      if (!claim) throw apiError(httpError, 404, "没有找到这条来源主张。", "PROVENANCE_CLAIM_NOT_FOUND");
      requireCurrentEtag(request, claim, httpError);
      const body = await readJsonBody(request);
      assertExactObject(body, ACTION_KEYS, "主张决定", httpError);
      if (body.confirm !== true) throw apiError(httpError, 400, "确认或撤回主张需要 confirm: true。", "PROVENANCE_CONFIRMATION_REQUIRED");
      const mutation = {
        confirm: true,
        expectedVersion: claim.version,
        idempotencyKey: requireIdempotencyKey(request, httpError)
      };
      const result = actionMatch[2] === "confirm"
        ? store.confirmProvenanceClaim(claim.id, mutation)
        : store.withdrawProvenanceClaim(claim.id, mutation);
      response.setHeader("ETag", result.claim.etag);
      return sendJson(response, 200, {
        changed: Boolean(result.changed),
        idempotent: Boolean(result.idempotent),
        claim: publicClaim(result.claim)
      });
    }

    if (url.pathname.startsWith("/api/provenance")) {
      throw httpError(request.method === "GET" ? 404 : 405, request.method === "GET"
        ? "来源护照接口不存在。"
        : "来源护照不支持该请求方法。");
    }
    return false;
  }

  return Object.freeze({ handle });
}

function resolveClientSource({ store, memoryId, selection, candidates, index, httpError }) {
  assertExactObject(selection, SOURCE_KEYS, `来源 ${index + 1}`, httpError);
  const kind = String(selection.sourceKind || "");
  if (!KINDS.has(kind)) throw apiError(httpError, 400, `来源 ${index + 1} 的类型无效。`, "PROVENANCE_KIND_INVALID");
  const relationKind = String(selection.relationKind || "");
  if (!RELATIONS.has(relationKind)) throw apiError(httpError, 400, `来源 ${index + 1} 的关系无效。`, "PROVENANCE_RELATION_INVALID");
  const locator = plainObject(selection.locator) ? selection.locator : null;
  if (!locator) throw apiError(httpError, 400, `来源 ${index + 1} 的定位信息无效。`, "PROVENANCE_LOCATOR_INVALID");

  const candidate = kind === "memory_text"
    ? candidates.find((item) => item.kind === kind)
    : candidates.find((item) => item.kind === kind && item.sourceKey === selection.sourceKey && (
      ["voice_segment"].includes(kind) || item.anchorKey === selection.anchorKey
    ));
  if (!candidate) throw apiError(httpError, 409, `来源 ${index + 1} 已不存在，请刷新后重新选择。`, "PROVENANCE_SOURCE_NOT_CURRENT");

  const catalogSelection = {
    kind,
    referenceId: candidate.referenceId,
    sourceKey: candidate.sourceKey,
    snapshotSha256: candidate.snapshotSha256,
    ...(kind === "memory_text" ? {
      startOffset: locator.startOffset,
      endOffset: locator.endOffset
    } : kind === "voice_segment" ? {
      startMs: Number.isSafeInteger(locator.startMs) ? locator.startMs : 0,
      endMs: Number.isSafeInteger(locator.endMs) ? locator.endMs : candidate.locator.durationMs
    } : { anchorKey: candidate.anchorKey })
  };
  const resolved = store.resolveProvenanceSource(memoryId, catalogSelection);
  if (!resolved || resolved.status !== "resolved" || !resolved.source) {
    throw apiError(httpError, 409, `来源 ${index + 1} 已变化或暂不可用，请刷新后重新核对。`, "PROVENANCE_SOURCE_NOT_CURRENT");
  }
  return catalogSourceToClaimSource(resolved.source, { relationKind, sensitive: false });
}

function publicPassport(passport = {}) {
  return {
    memoryId: String(passport.memoryId || ""),
    synthetic: false,
    summary: passport.summary || {},
    claims: Array.isArray(passport.claims) ? passport.claims.map(publicClaim) : []
  };
}

function publicClaim(claim = {}) {
  return {
    id: String(claim.id || ""),
    memoryId: String(claim.memoryId || ""),
    statement: String(claim.statement || ""),
    status: String(claim.status || "draft"),
    lifecycleStatus: String(claim.lifecycleStatus || "draft"),
    needsReview: Boolean(claim.needsReview),
    sourcesCurrent: Boolean(claim.sourcesCurrent),
    version: Number(claim.version) || 1,
    etag: String(claim.etag || ""),
    confirmedAt: String(claim.confirmedAt || ""),
    withdrawnAt: String(claim.withdrawnAt || ""),
    sources: Array.isArray(claim.sources) ? claim.sources.map(publicSource) : []
  };
}

function publicSource(source = {}) {
  const metadata = plainObject(source.snapshot?.metadata) ? source.snapshot.metadata : {};
  return {
    relationKind: String(source.relationKind || ""),
    kind: String(source.sourceKind || ""),
    label: String(metadata.label || source.sourceKind || "来源").slice(0, 120),
    excerpt: String(source.snapshot?.excerpt || "").slice(0, 4000),
    integrityStatus: String(source.integrityStatus || "source_changed"),
    reviewReason: String(source.reviewReason || "").slice(0, 160)
  };
}

function publicCandidate(source = {}) {
  return {
    schemaVersion: Number(source.schemaVersion) || 1,
    kind: String(source.kind || ""),
    referenceId: String(source.referenceId || ""),
    sourceKey: String(source.sourceKey || ""),
    anchorKey: String(source.anchorKey || ""),
    label: String(source.label || "来源").slice(0, 120),
    locator: plainObject(source.locator) ? source.locator : {},
    excerpt: String(source.excerpt || "").slice(0, 4000),
    snapshotSha256: String(source.snapshotSha256 || "")
  };
}

function syntheticPassport(memoryId) {
  return {
    memoryId,
    synthetic: true,
    summary: { claims: 1, sources: 1, draft: 0, confirmed: 1, needsReview: 0, withdrawn: 0 },
    claims: [{
      id: "demo-provenance-claim",
      memoryId,
      statement: "这条合成说法由馆主亲自绑定到逐字来源。",
      status: "confirmed",
      lifecycleStatus: "confirmed",
      needsReview: false,
      sourcesCurrent: true,
      version: 2,
      etag: "",
      synthetic: true,
      sources: [{
        relationKind: "supports",
        kind: "memory_text",
        label: "合成逐字原文",
        excerpt: "这里只演示来源关系，不代表事实认证。",
        integrityStatus: "source_verified",
        reviewReason: ""
      }]
    }]
  };
}

function requireCurrentEtag(request, claim, httpError) {
  const supplied = String(request.headers["if-match"] || "").trim();
  if (!supplied) throw apiError(httpError, 428, "缺少当前主张的 If-Match 条件。", "PROVENANCE_PRECONDITION_REQUIRED");
  if (supplied !== claim.etag) throw apiError(httpError, 412, "来源主张或来源状态已经变化，请刷新后重试。", "PROVENANCE_VERSION_CONFLICT");
}

function requireIdempotencyKey(request, httpError) {
  const value = String(request.headers["idempotency-key"] || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/u.test(value)) {
    throw apiError(httpError, 400, "Idempotency-Key 必须包含 8 至 120 个安全字符。", "PROVENANCE_IDEMPOTENCY_KEY_INVALID");
  }
  return value;
}

function assertExactObject(value, keys, label, httpError) {
  if (!plainObject(value)) throw apiError(httpError, 400, `${label}必须是 JSON 对象。`, "PROVENANCE_OBJECT_INVALID");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw apiError(httpError, 400, `${label}包含缺失或不支持的字段。`, "PROVENANCE_FIELD_SET_INVALID");
  }
}

function assertNoQuery(url, httpError) {
  if ([...url.searchParams.keys()].length) throw apiError(httpError, 400, "来源护照接口不接受查询参数。", "PROVENANCE_QUERY_INVALID");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function apiError(httpError, status, message, code) {
  const error = httpError(status, message, code);
  error.code = code;
  return error;
}

function assertDependencies({ store, sendJson, readJsonBody, httpError }) {
  const methods = [
    "listProvenanceSources", "resolveProvenanceSource", "getProvenancePassport", "getProvenanceClaim",
    "createProvenanceClaim", "confirmProvenanceClaim", "withdrawProvenanceClaim"
  ];
  if (!store || methods.some((name) => typeof store[name] !== "function") ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof httpError !== "function") {
    throw new TypeError("createProvenanceApi 依赖不完整。");
  }
}

module.exports = {
  createProvenanceApi,
  publicCandidate,
  publicClaim,
  publicPassport,
  resolveClientSource,
  syntheticPassport
};
