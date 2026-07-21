"use strict";

const path = require("node:path");

function getStaticAssetPolicy(relativePath, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();
  const noCache = ["index.html", "sw.js", "manifest.webmanifest"].includes(fileName);
  const normalized = String(relativePath || "").replace(/\\/gu, "/");
  const immutable = normalized.startsWith("assets/models/v17/") ||
    normalized.startsWith("assets/vendor/transformers-3.8.1/");
  return Object.freeze({
    contentType: ({
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".wasm": "application/wasm",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp"
    })[extension] || "application/octet-stream",
    cacheControl: noCache
      ? "no-cache, no-store, must-revalidate"
      : immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
    serviceWorkerAllowed: fileName === "sw.js"
  });
}

module.exports = { getStaticAssetPolicy };
