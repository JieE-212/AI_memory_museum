"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STAGING_GROUPS = Object.freeze([
  Object.freeze({ parent: ".exports", prefix: "time-isle-export-" }),
  Object.freeze({ parent: ".restore", prefix: "restore-" }),
  Object.freeze({ parent: ".inspect", prefix: "inspect-" })
]);

function cleanupArchiveStaging(options = {}) {
  const mediaRoot = requireAbsolutePath(options.mediaRoot, "mediaRoot");
  const minimumAgeMs = requireNonNegativeInteger(options.minimumAgeMs ?? 60 * 60 * 1000, "minimumAgeMs");
  const now = requireNonNegativeInteger(options.now ?? Date.now(), "now");
  const result = { removed: [], skipped: [] };
  if (!fs.existsSync(mediaRoot)) return result;
  const rootStat = fs.lstatSync(mediaRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    result.skipped.push({ path: mediaRoot, reason: "unsafe-media-root" });
    return result;
  }

  for (const group of STAGING_GROUPS) cleanupGroup(mediaRoot, group, minimumAgeMs, now, result);
  return result;
}

function cleanupGroup(mediaRoot, group, minimumAgeMs, now, result) {
  const parent = path.resolve(mediaRoot, group.parent);
  if (!isWithin(mediaRoot, parent) || !fs.existsSync(parent)) return;
  let parentStat;
  try { parentStat = fs.lstatSync(parent); }
  catch (error) { return result.skipped.push({ path: parent, reason: error.code || "stat-failed" }); }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    result.skipped.push({ path: parent, reason: "unsafe-parent" });
    return;
  }

  let names;
  try { names = fs.readdirSync(parent); }
  catch (error) { return result.skipped.push({ path: parent, reason: error.code || "read-failed" }); }
  const namePattern = new RegExp(`^${escapeRegExp(group.prefix)}[a-zA-Z0-9_-]{1,160}$`, "u");
  for (const name of names) {
    if (!namePattern.test(name)) continue;
    const target = path.resolve(parent, name);
    if (!isWithin(parent, target)) continue;
    try {
      const stat = fs.lstatSync(target);
      if (now - stat.mtimeMs < minimumAgeMs) continue;
      if (stat.isSymbolicLink()) fs.unlinkSync(target);
      else fs.rmSync(target, { recursive: true, force: true });
      result.removed.push(target);
    } catch (error) {
      result.skipped.push({ path: target, reason: error.code || "remove-failed" });
    }
  }
  try { fs.rmdirSync(parent); } catch { /* keep non-empty or concurrently used parent */ }
}

function requireAbsolutePath(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path.`);
  return path.resolve(value);
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer.`);
  return value;
}

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

module.exports = { cleanupArchiveStaging, STAGING_GROUPS };
