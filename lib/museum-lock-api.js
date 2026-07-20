"use strict";

const { withRequestAbort } = require("./archive-http");
const {
  LOCK_CONFIRMATION,
  UNLOCK_CONFIRMATION,
  assertNoRecoveryVerifier,
  auditMuseumLockTransition,
  publicMuseumLockState
} = require("./museum-lock-service");
const {
  createRecoveryVerifier,
  deriveRecoveryVerifier
} = require("./museum-lock-verifier");

const MAX_MUSEUM_LOCK_BODY_BYTES = 8 * 1024;
const TRANSITION_BODY_KEYS = new Set(["confirmation", "expectedRevision", "operationId", "passphrase"]);
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/u;

function createMuseumLockApi(options = {}) {
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const httpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  const createVerifier = options.createRecoveryVerifier || createRecoveryVerifier;
  const deriveVerifier = options.deriveRecoveryVerifier || deriveRecoveryVerifier;
  const requestAbort = options.withRequestAbort || withRequestAbort;
  assertDependencies({ store, sendJson, readJsonBody, httpError, createVerifier, deriveVerifier, requestAbort });

  async function handle(request, response, url) {
    if (!url?.pathname.startsWith("/api/museum-lock")) return false;

    if (request.method === "GET" && url.pathname === "/api/museum-lock") {
      assertNoQuery(url, httpError);
      const state = publicMuseumLockState(await Promise.resolve(store.getMuseumLockState()));
      assertNoRecoveryVerifier(state, "museum lock GET response");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("ETag", museumLockEtag(state));
      return sendJson(response, 200, {
        state,
        demo: interviewDemo,
        persisted: !interviewDemo,
        diskEncryptionProvided: false
      });
    }

    // Public-demo rejection intentionally precedes route validation, header
    // access, Content-Type parsing and request-body consumption.
    if (!new Set(["GET", "HEAD"]).has(request.method) && interviewDemo) {
      return sendJson(response, 403, {
        error: "The public demo cannot change museum write-lock state and did not read this request body.",
        code: "MUSEUM_LOCK_DEMO_READ_ONLY",
        interviewDemo: true,
        bodyBytesRead: 0
      });
    }

    const actionMatch = url.pathname.match(/^\/api\/museum-lock\/(lock|unlock)$/u);
    if (request.method === "POST" && actionMatch) {
      assertNoQuery(url, httpError);
      assertJsonContentType(request, httpError);
      return requestAbort(request, response, async (signal) => {
        signal.throwIfAborted();
        // Integrity is checked before body consumption. A missing, damaged or
        // unverifiable singleton therefore fails closed.
        const current = await Promise.resolve(store.getMuseumLockState());
        signal.throwIfAborted();
        const body = await readJsonBody(request, MAX_MUSEUM_LOCK_BODY_BYTES);
        signal.throwIfAborted();
        const action = actionMatch[1];
        assertTransitionBody(body, action, httpError);
        if (action === "unlock" && current.recoveryVerifier === null) {
          throw codedHttpError(
            httpError,
            409,
            "No recovery verifier has been configured for this museum.",
            "MUSEUM_LOCK_VERIFIER_NOT_CONFIGURED"
          );
        }
        const verifier = current.recoveryVerifier === null
          ? await createVerifier(body.passphrase, { signal })
          : await deriveVerifier(body.passphrase, current.recoveryVerifier, { signal });
        signal.throwIfAborted();
        const result = await Promise.resolve(store.transitionMuseumLock({
          action,
          confirmation: body.confirmation,
          expectedRevision: body.expectedRevision,
          operationId: body.operationId,
          verifier
        }, { demoMode: false }));
        const state = publicMuseumLockState(result.persistenceRecord);
        const transition = auditMuseumLockTransition(result);
        assertNoRecoveryVerifier(state, "museum lock transition response");
        assertNoRecoveryVerifier(transition, "museum lock transition audit response");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("ETag", museumLockEtag(state));
        return sendJson(response, 200, {
          state,
          transition,
          diskEncryptionProvided: false
        });
      });
    }

    throw codedHttpError(
      httpError,
      request.method === "GET" ? 404 : 405,
      request.method === "GET"
        ? "Museum lock API route was not found."
        : "Museum lock API does not support this request method.",
      request.method === "GET" ? "MUSEUM_LOCK_ROUTE_NOT_FOUND" : "MUSEUM_LOCK_METHOD_NOT_ALLOWED"
    );
  }

  return Object.freeze({ handle });
}

function assertTransitionBody(body, action, httpError) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(body))) {
    throw codedHttpError(httpError, 400, "Museum lock request must be a JSON object.", "MUSEUM_LOCK_REQUEST_INVALID");
  }
  const keys = Object.keys(body);
  const unknown = keys.filter((key) => !TRANSITION_BODY_KEYS.has(key));
  const missing = [...TRANSITION_BODY_KEYS].filter((key) => !Object.hasOwn(body, key));
  if (unknown.length || missing.length) {
    throw codedHttpError(
      httpError,
      400,
      "Museum lock request fields are incomplete or unsupported.",
      "MUSEUM_LOCK_REQUEST_INVALID"
    );
  }
  if (typeof body.passphrase !== "string") {
    throw codedHttpError(httpError, 400, "Recovery passphrase is required.", "MUSEUM_LOCK_PASSPHRASE_INVALID");
  }
  const requiredConfirmation = action === "lock" ? LOCK_CONFIRMATION : UNLOCK_CONFIRMATION;
  if (body.confirmation !== requiredConfirmation) {
    throw codedHttpError(
      httpError,
      400,
      `Explicit ${action} confirmation is required.`,
      "MUSEUM_LOCK_CONFIRMATION_REQUIRED"
    );
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      body.expectedRevision >= Number.MAX_SAFE_INTEGER) {
    throw codedHttpError(httpError, 400, "Museum lock revision is invalid.", "MUSEUM_LOCK_REQUEST_INVALID");
  }
  if (typeof body.operationId !== "string" || !OPERATION_ID_PATTERN.test(body.operationId)) {
    throw codedHttpError(httpError, 400, "Museum lock operationId is invalid.", "MUSEUM_LOCK_REQUEST_INVALID");
  }
}

function assertJsonContentType(request, httpError) {
  const contentType = String(request.headers?.["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw codedHttpError(
      httpError,
      415,
      "Museum lock transitions require application/json.",
      "MUSEUM_LOCK_CONTENT_TYPE_INVALID"
    );
  }
}

function assertNoQuery(url, httpError) {
  if ([...url.searchParams.keys()].length) {
    throw codedHttpError(httpError, 400, "Museum lock API does not accept query parameters.", "MUSEUM_LOCK_QUERY_INVALID");
  }
}

function museumLockEtag(state) {
  return `"museum-lock-${Number(state?.revision) || 0}"`;
}

function codedHttpError(httpError, statusCode, message, code) {
  const error = httpError(statusCode, message);
  error.code = code;
  return error;
}

function assertDependencies({ store, sendJson, readJsonBody, httpError, createVerifier, deriveVerifier, requestAbort }) {
  if (!store || typeof store.getMuseumLockState !== "function" || typeof store.transitionMuseumLock !== "function" ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof httpError !== "function" ||
      typeof createVerifier !== "function" || typeof deriveVerifier !== "function" || typeof requestAbort !== "function") {
    throw new TypeError("createMuseumLockApi dependencies are incomplete.");
  }
}

module.exports = {
  MAX_MUSEUM_LOCK_BODY_BYTES,
  TRANSITION_BODY_KEYS,
  createMuseumLockApi,
  museumLockEtag
};
