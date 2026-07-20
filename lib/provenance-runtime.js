"use strict";

const {
  catalogSourceToClaimSource,
  mapCatalogResolutionToResolverResult,
  stableStringify
} = require("./provenance-service");

function createStoredCatalogSourceResolver(options = {}) {
  const catalog = options.catalog;
  if (!catalog || typeof catalog.listSources !== "function" || typeof catalog.resolveSource !== "function") {
    throw new TypeError("createStoredCatalogSourceResolver requires a provenance source catalog.");
  }

  return function resolveStoredSource(source, context = {}) {
    const memoryId = String(context.memoryId || source?.originRef?.memoryId || "");
    const catalogIdentity = source?.snapshot?.metadata?.catalog;
    if (!memoryId || !plainObject(catalogIdentity)) {
      return { status: "source_changed", reason: "来源目录身份缺失，需要人工重新核对。" };
    }

    const direct = safelyResolve(catalog, memoryId, buildSelection(source.sourceKind, catalogIdentity, source.locator));
    const directResult = mapCatalogResolutionToResolverResult(direct);
    if (directResult.status === "source_verified") return directResult;

    // A strict restore can remap memory/item identifiers while preserving the
    // evidence bytes and locator. Rebinding is read-only and succeeds only if
    // a freshly resolved live source normalizes to the exact stored snapshot.
    for (const candidate of safelyList(catalog, memoryId)) {
      if (candidate.kind !== source.sourceKind) continue;
      const resolution = safelyResolve(catalog, memoryId, selectionForCandidate(candidate, source.locator));
      if (resolution?.status !== "resolved" || !resolution.source) continue;
      let live;
      try {
        live = catalogSourceToClaimSource(resolution.source, {
          relationKind: source.relationKind,
          sensitive: Boolean(source.sensitive)
        });
      } catch {
        continue;
      }
      if (sameEvidence(live, source)) {
        return { status: "source_verified", reason: "恢复后的来源身份已按相同字节与定位重新核对。" };
      }
    }
    return directResult;
  };
}

function buildSelection(kind, identity, locator = {}) {
  const base = {
    kind,
    referenceId: identity.referenceId,
    sourceKey: identity.sourceKey,
    snapshotSha256: identity.snapshotSha256
  };
  if (kind === "memory_text") return { ...base, startOffset: locator.startOffset, endOffset: locator.endOffset };
  if (kind === "voice_segment") return { ...base, startMs: locator.startMs, endMs: locator.endMs };
  return { ...base, anchorKey: identity.anchorKey };
}

function selectionForCandidate(candidate, locator = {}) {
  return buildSelection(candidate.kind, {
    referenceId: candidate.referenceId,
    sourceKey: candidate.sourceKey,
    anchorKey: candidate.anchorKey,
    snapshotSha256: candidate.snapshotSha256
  }, locator);
}

function sameEvidence(live, stored) {
  return live.sourceKind === stored.sourceKind &&
    live.sourceKey === stored.sourceKey &&
    live.sourceSha256 === stored.snapshot?.sourceSha256 &&
    live.excerpt === stored.snapshot?.excerpt &&
    stableStringify(live.locator) === stableStringify(stored.locator);
}

function safelyResolve(catalog, memoryId, selection) {
  try { return catalog.resolveSource(memoryId, selection); }
  catch { return "source_changed"; }
}

function safelyList(catalog, memoryId) {
  try {
    const value = catalog.listSources(memoryId);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

module.exports = {
  buildSelection,
  createStoredCatalogSourceResolver,
  sameEvidence,
  selectionForCandidate
};
