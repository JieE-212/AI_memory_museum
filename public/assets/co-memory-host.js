(function initializeTimeIsleCoMemoryHost(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TimeIsleCoMemoryHost = factory();
}(typeof globalThis !== "undefined" ? globalThis : self, function createCoMemoryHostModule() {
  "use strict";

  function createController(options = {}) {
    const letters = options.letters || globalThis.TimeIsleCoMemoryLetters;
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!letters || typeof letters.createController !== "function" || !fetchImpl) return null;
    return letters.createController({
      demo: Boolean(options.demo),
      fetch: fetchImpl,
      confirmResponse: (contract, context) => confirmResponse(fetchImpl, contract, context),
      onChanged: typeof options.onChanged === "function" ? options.onChanged : () => {}
    });
  }

  async function confirmResponse(fetchImpl, contract, context = {}) {
    const response = await fetchImpl("/api/co-memory-responses/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": createIdempotencyKey(contract)
      },
      body: JSON.stringify(contract),
      credentials: "same-origin",
      signal: context?.signal
    });
    const contentType = response.headers?.get?.("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error((payload && typeof payload === "object" ? payload.error : payload) || `保存失败（${response.status}）`);
      error.status = response.status;
      error.code = payload && typeof payload === "object" ? String(payload.code || "") : "";
      throw error;
    }
    if (!payload?.record || payload.record.kind !== "co_memory_response") {
      const error = new Error("服务器未返回可核对的共忆回信记录。");
      error.code = "CO_MEMORY_RESPONSE_RESULT_INVALID";
      throw error;
    }
    return payload.record;
  }

  function createIdempotencyKey(contract) {
    const requestSha256 = String(contract?.requestSha256 || "");
    if (!/^[a-f0-9]{64}$/u.test(requestSha256)) {
      const error = new Error("共忆回信缺少可重试的请求摘要。");
      error.code = "CO_MEMORY_REQUEST_BINDING_INVALID";
      throw error;
    }
    return `co-memory-confirm:${requestSha256}`;
  }

  return Object.freeze({ confirmResponse, createController, createIdempotencyKey });
}));
