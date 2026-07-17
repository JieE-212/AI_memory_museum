"use strict";

function createRevisionApi(options = {}) {
  const { store, sendJson, readJsonBody, httpError, decorateMemory } = options;
  const normalizeNote = typeof options.normalizeNote === "function"
    ? options.normalizeNote
    : (value) => String(value || "").trim().slice(0, 500);
  if (!store || typeof store.listMemoryRevisions !== "function" ||
      typeof store.restoreMemoryRevision !== "function" ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" ||
      typeof httpError !== "function" || typeof decorateMemory !== "function") {
    throw new TypeError("Revision API dependencies are required.");
  }

  async function handle(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/revisions") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
      return respond(response, 200, {
        revisions: store.listRecentMemoryRevisions({ limit }).map(publicRevisionSummary)
      });
    }

    const revisionMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})\/revisions\/([a-zA-Z0-9_-]{1,120})$/);
    if (request.method === "GET" && revisionMatch) {
      const memory = requireMemory(revisionMatch[1]);
      const revision = store.getMemoryRevision(memory.id, revisionMatch[2]);
      if (!revision) throw httpError(404, "没有找到这条历史版本。");
      return respondMemory(response, 200, {
        revision: publicRevision(revision, { includeSnapshot: true })
      }, memory);
    }

    const restoreMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})\/revisions\/([a-zA-Z0-9_-]{1,120})\/restore$/);
    if (request.method === "POST" && restoreMatch) {
      const existing = requireMemory(restoreMatch[1]);
      const body = await readJsonBody(request);
      const result = store.restoreMemoryRevision(existing.id, restoreMatch[2], {
        expectedUpdatedAt: requireMemoryPrecondition(request, body, existing, httpError),
        changeNote: normalizeNote(body.changeNote)
      });
      const memory = decorateMemory(result.memory);
      return respondMemory(response, 200, {
        ok: true,
        changed: result.changed,
        memory,
        revision: publicRevision(result.revision)
      }, memory);
    }

    const listMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})\/revisions$/);
    if (request.method === "GET" && listMatch) {
      const memory = requireMemory(listMatch[1]);
      return respondMemory(response, 200, {
        memoryId: memory.id,
        revisions: store.listMemoryRevisions(memory.id).map(publicRevision).reverse()
      }, memory);
    }
    return false;
  }

  function requireMemory(id) {
    const memory = store.getMemory(id);
    if (!memory) throw httpError(404, "没有找到这件展品。");
    return memory;
  }

  function respond(response, statusCode, payload) {
    return sendJson(response, statusCode, payload);
  }

  function respondMemory(response, statusCode, payload, memory) {
    response.setHeader("ETag", memoryEtag(memory));
    return sendJson(response, statusCode, payload);
  }

  return Object.freeze({ handle });
}

function memoryEtag(memory) {
  const version = String(memory?.updatedAt || memory?.createdAt || "");
  return `"memory-${Buffer.from(version, "utf8").toString("base64url")}"`;
}

function requireMemoryPrecondition(request, body, currentMemory, httpError) {
  const ifMatch = String(request.headers["if-match"] || "").trim();
  if (ifMatch) {
    if (ifMatch !== memoryEtag(currentMemory)) throw memoryVersionConflict(currentMemory, httpError);
    return currentMemory.updatedAt || currentMemory.createdAt;
  }
  const expectedUpdatedAt = String(body?.expectedUpdatedAt || "").trim();
  if (expectedUpdatedAt) return expectedUpdatedAt;
  throw httpError(428, "编辑或恢复展品前必须携带 If-Match 版本条件。");
}

function memoryVersionConflict(memory, httpError) {
  const error = httpError(412, "这件展品已在别处更新，请刷新后再修改。");
  error.code = "MEMORY_VERSION_CONFLICT";
  error.currentUpdatedAt = memory?.updatedAt || memory?.createdAt || "";
  return error;
}

function publicRevision(revision, options = {}) {
  if (!revision) return null;
  return {
    id: revision.id,
    memoryId: revision.memoryId,
    ...(revision.memoryTitle ? { memoryTitle: revision.memoryTitle } : {}),
    revisionNo: revision.revisionNo,
    changeKind: revision.changeKind,
    changeNote: revision.changeNote || "",
    restoredFromRevisionId: revision.restoredFromRevisionId || "",
    sourceUpdatedAt: revision.sourceUpdatedAt,
    createdAt: revision.createdAt,
    ...(options.includeSnapshot ? { snapshot: revision.snapshot } : {})
  };
}

function publicRevisionSummary(revision) {
  if (!revision) return null;
  return {
    memoryId: revision.memoryId,
    memoryTitle: revision.memoryTitle || "未命名记忆",
    revisionNo: revision.revisionNo,
    changeKind: revision.changeKind,
    createdAt: revision.createdAt
  };
}

module.exports = {
  createRevisionApi,
  memoryEtag,
  publicRevision,
  publicRevisionSummary,
  requireMemoryPrecondition
};
