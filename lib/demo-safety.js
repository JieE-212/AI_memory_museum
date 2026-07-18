"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEMO_PATH_PREFIX = "ai-memory-museum-";
const DEMO_LIMITS = Object.freeze({
  memories: 32,
  agentRuns: 64,
  curatorAgentRuns: 64,
  memoryEvents: 32,
  curatorQuestions: 96
});

/**
 * Demo startup deletes its ephemeral database and media tree before reseeding.
 * Refuse to perform that cleanup unless both targets resolve to a dedicated
 * project-owned name below the operating system's temporary directory.
 */
function assertSafeDemoStorage({ dbPath, mediaRoot, tempRoot = os.tmpdir() } = {}) {
  const safeTempRoot = resolveThroughExistingAncestor(requirePath(tempRoot, "tempRoot"));
  const safeDbPath = assertSafeTarget(dbPath, "DB_PATH", safeTempRoot);
  const safeMediaRoot = assertSafeTarget(mediaRoot, "MEDIA_ROOT", safeTempRoot);
  if (samePath(safeDbPath, safeMediaRoot)) {
    throw demoSafetyError("公开 Demo 的 DB_PATH 与 MEDIA_ROOT 不能指向同一路径。");
  }
  if (isWithin(safeMediaRoot, safeDbPath) || isWithin(safeDbPath, safeMediaRoot)) {
    throw demoSafetyError("公开 Demo 的 DB_PATH 与 MEDIA_ROOT 不能互相包含。");
  }
  return { dbPath: path.resolve(dbPath), mediaRoot: path.resolve(mediaRoot), tempRoot: safeTempRoot };
}

function resetDemoStorage({ dbPath, mediaRoot, tempRoot = os.tmpdir() } = {}) {
  const safe = assertSafeDemoStorage({ dbPath, mediaRoot, tempRoot });
  [safe.dbPath, `${safe.dbPath}-shm`, `${safe.dbPath}-wal`].forEach((filePath) => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // A concurrent warm instance may already own the file; seeding is idempotent.
    }
  });
  try {
    fs.rmSync(safe.mediaRoot, { recursive: true, force: true });
  } catch {
    // A warm instance may still serve read-only media; a later cold start retries.
  }
  return safe;
}

function createDemoCapacityGuard({ enabled = false, withTransaction, errorFactory } = {}) {
  const makeError = typeof errorFactory === "function"
    ? errorFactory
    : (statusCode, message) => Object.assign(new Error(message), { statusCode });
  const assertCapacity = (kind, current) => {
    if (!enabled) return;
    const limit = DEMO_LIMITS[kind];
    if (!Number.isInteger(limit) || Number(current) < limit) return;
    throw makeError(429, "公开 Demo 的临时体验容量已满，请等待实例刷新后再试。");
  };
  const write = (kind, getCurrent, mutation) => {
    if (!enabled) return mutation();
    if (typeof withTransaction !== "function" || typeof getCurrent !== "function" || typeof mutation !== "function") {
      throw new TypeError("Demo capacity guard dependencies are incomplete.");
    }
    return withTransaction(() => {
      assertCapacity(kind, getCurrent());
      return mutation();
    });
  };
  return Object.freeze({ limits: DEMO_LIMITS, assert: assertCapacity, write });
}

function assertSafeTarget(value, label, safeTempRoot) {
  const target = resolveThroughExistingAncestor(requirePath(value, label));
  if (!isWithin(safeTempRoot, target) || samePath(safeTempRoot, target)) {
    throw demoSafetyError(`${label} 必须位于系统临时目录内。`);
  }
  if (!path.basename(target).toLowerCase().startsWith(DEMO_PATH_PREFIX)) {
    throw demoSafetyError(`${label} 必须使用 ${DEMO_PATH_PREFIX} 开头的专用名称。`);
  }
  return target;
}

function resolveThroughExistingAncestor(value) {
  const suffix = [];
  let cursor = path.resolve(value);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (samePath(parent, cursor)) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const base = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.resolve(base, ...suffix);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function requirePath(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw demoSafetyError(`${label} 不能为空。`);
  return normalized;
}

function demoSafetyError(message) {
  const error = new Error(message);
  error.code = "DEMO_STORAGE_UNSAFE";
  return error;
}

module.exports = { assertSafeDemoStorage, resetDemoStorage, createDemoCapacityGuard, DEMO_LIMITS, DEMO_PATH_PREFIX };
