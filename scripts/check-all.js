"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const withoutSmoke = process.argv.includes("--without-smoke");
const syntaxFiles = [
  "scripts/check-all.js",
  "server.js",
  "database.js",
  "api/index.js",
  "lib/archaeology.js",
  "lib/archaeology-backup.js",
  "lib/demo-safety.js",
  "lib/request-security.js",
  "lib/time-isle-archive.js",
  "lib/media-format.js",
  "lib/media-policy.js",
  "lib/media-storage.js",
  "lib/media-database.js",
  "lib/media-evidence.js",
  "lib/media-similarity.js",
  "lib/exif-hints.js",
  "lib/media-backup.js",
  "lib/media-restore.js",
  "lib/media-api.js",
  "public/assets/portability.js",
  "public/assets/media-intelligence.js",
  "public/assets/media.js",
  "public/assets/media-evidence.js",
  "public/assets/media-compare.js",
  "public/assets/media-ocr.js",
  "public/assets/media-lab.js",
  "public/assets/app.js"
];
const checks = [
  "scripts/frontend-check.js",
  "scripts/demo-safety-check.js",
  "scripts/request-security-check.js",
  "scripts/archaeology-check.js",
  "scripts/media-format-check.js",
  "scripts/media-storage-check.js",
  "scripts/media-api-check.js",
  "scripts/media-database-check.js",
  "scripts/media-evidence-check.js",
  "scripts/archive-check.js",
  "scripts/exif-hints-check.js",
  "scripts/media-similarity-check.js",
  "scripts/media-backup-check.js",
  "scripts/media-restore-check.js",
  "scripts/media-compare-check.js",
  "scripts/media-ocr-check.js",
  "scripts/media-lab-check.js",
  ...withoutSmoke ? [] : ["scripts/api-smoke.js"]
];

for (const file of syntaxFiles) run(["--check", file], `语法检查 ${file}`);
for (const file of checks) run([file], `回归检查 ${file}`);
console.log(withoutSmoke ? "Build checks passed." : "All project checks passed.");

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.status === 0) return;
  console.error(`${label} 失败。`);
  process.exit(result.status || 1);
}
