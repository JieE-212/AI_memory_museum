"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { cleanupArchiveStaging } = require("../lib/archive-staging");

let assertions = 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-staging-check-"));

try {
  const now = Date.now();
  const old = new Date(now - 2 * 60 * 60 * 1000);
  const fresh = new Date(now - 10 * 60 * 1000);
  const stale = [
    path.join(root, ".exports", "time-isle-export-ABC123"),
    path.join(root, ".restore", "restore-00000000-0000-4000-8000-000000000000"),
    path.join(root, ".restore", "restore-00000000-0000-4000-8000-000000000000-input-ABC123"),
    path.join(root, ".inspect", "inspect-00000000-0000-4000-8000-000000000000"),
    path.join(root, ".drill", "drill-00000000-0000-4000-8000-000000000000")
  ];
  const freshDirectory = path.join(root, ".exports", "time-isle-export-FRESH1");
  const unrelated = path.join(root, ".restore", "user-folder");
  for (const directory of [...stale, freshDirectory, unrelated]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "private.txt"), "synthetic-private-canary");
  }
  stale.forEach((directory) => fs.utimesSync(directory, old, old));
  fs.utimesSync(freshDirectory, fresh, fresh);
  fs.utimesSync(unrelated, old, old);

  const result = cleanupArchiveStaging({ mediaRoot: root, minimumAgeMs: 60 * 60 * 1000, now });
  check(result.removed.length === 5, "四类过期归档暂存及崩溃遗留的流式回放目录都会被清理");
  check(stale.every((directory) => !fs.existsSync(directory)), "过期暂存中的合成明文不会残留");
  check(fs.existsSync(freshDirectory), "仍在安全年龄窗口内的暂存不会被误删");
  check(fs.existsSync(unrelated), "名称不属于归档暂存契约的目录不会被清理");

  const unsafeParent = path.join(root, ".inspect");
  fs.rmSync(unsafeParent, { recursive: true, force: true });
  let symlinkCreated = false;
  try {
    fs.symlinkSync(path.join(root, ".restore"), unsafeParent, process.platform === "win32" ? "junction" : "dir");
    symlinkCreated = true;
  } catch { /* Windows environments may disallow link creation. */ }
  if (symlinkCreated) {
    const guarded = cleanupArchiveStaging({ mediaRoot: root, minimumAgeMs: 0, now });
    check(guarded.skipped.some((item) => item.path === unsafeParent && item.reason === "unsafe-parent"), "符号链接父目录会被拒绝且不会跟随到真实目录");
    check(fs.existsSync(unrelated), "拒绝符号链接父目录后不会删除链接目标内容");
  }

  assert.throws(() => cleanupArchiveStaging({ mediaRoot: "relative" }), /absolute path/u);
  assertions += 1;
  console.log(`Archive staging checks passed: ${assertions} assertions.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}
