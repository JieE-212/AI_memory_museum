"use strict";

const { createCollectionHealthService } = require("./collection-health");

function createCollectionHealthApi(options = {}) {
  const { store, mediaStorage, voiceStorage, mediaApi, voiceApi, sendJson, readJsonBody, httpError } = options;
  if (!store || typeof store.runDatabaseHealthChecks !== "function" ||
      !mediaStorage || typeof mediaStorage.verifyVariant !== "function" ||
      !voiceStorage || typeof voiceStorage.verify !== "function" ||
      !mediaApi || typeof mediaApi.withMediaOperation !== "function" ||
      !voiceApi || typeof voiceApi.withVoiceOperation !== "function" ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof httpError !== "function") {
    throw new TypeError("Collection health API dependencies are required.");
  }

  const service = createCollectionHealthService({
    getDatabaseHealthSnapshot: ({ signal }) => store.runDatabaseHealthChecks({ signal }),
    media: {
      listAssets: ({ signal }) => listAll("listMediaAssets", (asset) => ({ ...asset, variants: store.listMediaVariants(asset.id) }), signal),
      verifyVariant: (variant, context) => mediaStorage.verifyVariant(variant, { signal: context.signal })
    },
    voice: {
      listAssets: ({ signal }) => listAll("listVoiceAssets", (asset) => asset, signal),
      verifyAsset: (asset, context) => voiceStorage.verify(asset, { signal: context.signal })
    },
    runExclusive: (operation) => mediaApi.withMediaOperation(() => voiceApi.withVoiceOperation(operation))
  });

  async function handle(request, response, url) {
    if (request.method === "POST" && url.pathname === "/api/collection-health/scans") {
      const body = await readJsonBody(request);
      return sendJson(response, 202, { scan: service.start({ scope: body.scope || "full" }) });
    }
    const match = url.pathname.match(/^\/api\/collection-health\/scans\/([A-Za-z][A-Za-z0-9_-]{0,119})$/);
    if (!match) return false;
    if (request.method === "GET") {
      const scan = service.get(match[1]);
      if (!scan) throw httpError(404, "没有找到这次馆藏体检，结果可能已过期。");
      return sendJson(response, 200, { scan });
    }
    if (request.method === "DELETE") {
      const scan = service.cancel(match[1]);
      if (!scan) throw httpError(404, "没有找到这次馆藏体检，结果可能已过期。");
      return sendJson(response, 202, { scan });
    }
    return false;
  }

  function listAll(method, decorate, signal) {
    const output = [];
    let offset = 0;
    while (true) {
      signal?.throwIfAborted?.();
      const page = store[method]({ limit: 500, offset });
      output.push(...page.map(decorate));
      if (page.length < 500) return output;
      offset += page.length;
    }
  }

  return Object.freeze({ handle, service });
}

module.exports = { createCollectionHealthApi };
