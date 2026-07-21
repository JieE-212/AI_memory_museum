"use strict";

const { evaluateMuseumWriteGate } = require("./museum-lock-service");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCK_CONTROL_PATHS = new Set(["/api/museum-lock/lock", "/api/museum-lock/unlock"]);
const READ_ONLY_POST_PATHS = new Set([
  "/api/archive/inspect",
  "/api/recovery-drills/structural",
  "/api/recovery-drills/isolated-restore"
]);

function createMuseumWriteRuntime(options = {}) {
  const store = options.store;
  if (!store || typeof store.getMuseumLockState !== "function") {
    throw new TypeError("Museum write runtime requires lock-state storage.");
  }
  let activeMutations = 0;
  let transitionPending = false;
  const idleWaiters = new Set();

  async function enterHttpRequest(request, _response, url) {
    const method = String(request?.method || "").toUpperCase();
    const pathname = String(url?.pathname || "");
    if (!pathname.startsWith("/api/")) return allowedDecision(method, pathname, false);
    const lockControl = method === "POST" && LOCK_CONTROL_PATHS.has(pathname);
    const mutation = isMutationRequest(method, pathname);

    if (lockControl) {
      if (transitionPending) {
        return blockedDecision(423, "MUSEUM_LOCK_TRANSITION_PENDING", method, pathname,
          "Another museum write-protection transition is still active; this request body was not read.");
      }
      transitionPending = true;
      try {
        await waitForIdle();
        const decision = evaluateMuseumWriteGate({
          method,
          pathname,
          lockState: store.getMuseumLockState(),
          demoMode: false,
          mutation
        });
        return leasedDecision(decision, releaseTransition);
      } catch (error) {
        releaseTransition();
        throw error;
      }
    } else if (transitionPending && mutation) {
      return blockedDecision(423, "MUSEUM_LOCK_TRANSITION_PENDING", method, pathname,
        "Museum write protection is changing; this request body was not read.");
    }

    const decision = evaluateMuseumWriteGate({
      method,
      pathname,
      lockState: store.getMuseumLockState(),
      demoMode: false,
      mutation
    });
    if (decision.allowed && mutation) {
      activeMutations += 1;
      return leasedDecision(decision, releaseMutation);
    }
    return decision;
  }

  async function runMaintenance(operation) {
    if (typeof operation !== "function") throw new TypeError("Maintenance operation must be a function.");
    if (transitionPending || store.getMuseumLockState().status === "locked") {
      return Object.freeze({ skipped: true, reason: transitionPending ? "lock-transition" : "museum-locked" });
    }
    activeMutations += 1;
    try {
      return await operation();
    } finally {
      releaseMutation();
    }
  }

  function releaseMutation() {
    if (activeMutations > 0) activeMutations -= 1;
    notifyIdle();
  }

  function releaseTransition() {
    transitionPending = false;
    notifyIdle();
  }

  function waitForIdle() {
    if (activeMutations === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  }

  function notifyIdle() {
    if (activeMutations !== 0) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  return Object.freeze({ enterHttpRequest, runMaintenance });
}

function isMutationRequest(method, pathname) {
  if (SAFE_METHODS.has(method)) return false;
  if (method === "POST" && (LOCK_CONTROL_PATHS.has(pathname) || READ_ONLY_POST_PATHS.has(pathname))) return false;
  return true;
}

function leasedDecision(decision, release) {
  let settled = false;
  return Object.freeze({
    ...decision,
    settle() {
      if (settled) return;
      settled = true;
      release();
    }
  });
}

function allowedDecision(method, pathname, mutation) {
  return Object.freeze({ allowed: true, statusCode: 200, code: "MUSEUM_LOCK_NON_API_ALLOWED", method, pathname, mutation, bodyBytesRead: 0 });
}

function blockedDecision(statusCode, code, method, pathname, reason) {
  return Object.freeze({ allowed: false, statusCode, code, method, pathname, mutation: true, reason, bodyBytesRead: 0 });
}

module.exports = { createMuseumWriteRuntime, isMutationRequest };
