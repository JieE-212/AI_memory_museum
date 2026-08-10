"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const MAX_CACHED_BYTES = 1024 * 1024;
const MAX_CACHE_BYTES = 12 * 1024 * 1024;

function createStaticResponder(options = {}) {
  const publicDir = path.resolve(String(options.publicDir || ""));
  const getPolicy = options.getPolicy;
  const makeHttpError = options.httpError;
  const openReadStream = options.createReadStream || fs.createReadStream;
  if (!publicDir || typeof getPolicy !== "function" || typeof makeHttpError !== "function") {
    throw new TypeError("static responder 缺少 publicDir、getPolicy 或 httpError。");
  }
  const cache = { entries: new Map(), bytes: 0 };

  return function serveStatic(request, response, urlPath) {
    const relative = resolveRelativePath(urlPath, makeHttpError);
    const filePath = path.resolve(publicDir, relative);
    if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== path.join(publicDir, "index.html")) {
      throw makeHttpError(403, "禁止访问该路径。");
    }
    if (!fs.existsSync(filePath)) throw makeHttpError(404, "页面不存在。");
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw makeHttpError(404, "页面不存在。");

    const policy = getPolicy(relative, filePath);
    const compressible = isCompressible(policy.contentType) && stat.size >= 256;
    const gzipEligible = compressible && stat.size <= MAX_CACHED_BYTES;
    const representation = selectEncoding(request.headers["accept-encoding"], gzipEligible);
    response.setHeader("Vary", "Accept-Encoding");
    if (!representation) {
      response.statusCode = 406;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : "没有可接受的静态资源编码。");
      return;
    }
    const acceptsGzip = representation === "gzip";
    const etag = weakStatEtag(stat, representation);

    response.setHeader("Content-Type", policy.contentType);
    response.setHeader("Cache-Control", policy.cacheControl);
    response.setHeader("ETag", etag);
    if (acceptsGzip) response.setHeader("Content-Encoding", "gzip");
    if (policy.serviceWorkerAllowed) response.setHeader("Service-Worker-Allowed", "/");

    if (etagMatches(request.headers["if-none-match"], etag)) {
      response.statusCode = 304;
      response.end();
      return;
    }

    response.statusCode = 200;
    if (request.method === "HEAD") {
      const length = acceptsGzip ? readSmallAsset(cache, filePath, stat).gzip.length : stat.size;
      response.setHeader("Content-Length", String(length));
      response.end();
      return;
    }
    if (gzipEligible) {
      const asset = readSmallAsset(cache, filePath, stat);
      const body = acceptsGzip ? asset.gzip : asset.source;
      response.setHeader("Content-Length", String(body.length));
      response.end(body);
      return;
    }
    response.setHeader("Content-Length", String(stat.size));
    const stream = openReadStream(filePath);
    stream.once("error", (error) => {
      if (response.writableEnded) return;
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.removeHeader("Content-Length");
      response.removeHeader("ETag");
      response.statusCode = error?.code === "ENOENT" ? 404 : 500;
      response.setHeader("Cache-Control", "no-store");
      response.end("静态资源暂时无法读取。");
    });
    stream.pipe(response);
  };
}

function resolveRelativePath(urlPath, makeHttpError) {
  let pathname = urlPath === "/" ? "/index.html" : urlPath;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    throw makeHttpError(400, "无效路径。");
  }
  return path.normalize(pathname).replace(/^([/\\])+/, "");
}

function readSmallAsset(cache, filePath, stat) {
  const key = `${stat.size}:${stat.mtimeMs}`;
  const current = cache.entries.get(filePath);
  if (current?.key === key) {
    cache.entries.delete(filePath);
    cache.entries.set(filePath, current);
    return current;
  }
  if (current) {
    cache.bytes -= current.bytes;
    cache.entries.delete(filePath);
  }
  const source = fs.readFileSync(filePath);
  const gzip = zlib.gzipSync(source, { level: zlib.constants.Z_BEST_SPEED });
  const asset = {
    key,
    source,
    gzip,
    bytes: source.length + gzip.length
  };
  while (cache.bytes + asset.bytes > MAX_CACHE_BYTES && cache.entries.size) {
    const [oldestPath, oldest] = cache.entries.entries().next().value;
    cache.entries.delete(oldestPath);
    cache.bytes -= oldest.bytes;
  }
  cache.entries.set(filePath, asset);
  cache.bytes += asset.bytes;
  return asset;
}

function weakStatEtag(stat, representation) {
  return `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}-${representation}"`;
}

function selectEncoding(header, gzipEligible) {
  const value = String(header || "").trim();
  if (!value) return "identity";
  const preferences = new Map();
  for (const token of value.split(",")) {
    const [namePart, ...parameters] = token.trim().toLowerCase().split(";");
    if (!namePart) continue;
    let quality = 1;
    for (const parameter of parameters) {
      if (!/^q\s*=/u.test(parameter.trim())) continue;
      const parsed = Number(parameter.split("=").slice(1).join("=").trim());
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    }
    preferences.set(namePart, quality);
  }
  const wildcard = preferences.get("*");
  const identityQuality = preferences.has("identity") ? preferences.get("identity") : wildcard === 0 ? 0 : 1;
  const gzipQuality = gzipEligible
    ? preferences.has("gzip") ? preferences.get("gzip") : wildcard ?? 0
    : 0;
  if (identityQuality <= 0 && gzipQuality <= 0) return null;
  return gzipQuality > 0 && gzipQuality >= identityQuality ? "gzip" : "identity";
}

function isCompressible(contentType) {
  const value = String(contentType || "").toLowerCase();
  return value.startsWith("text/") || /(?:javascript|json|xml|svg|manifest)/u.test(value);
}

function etagMatches(header, etag) {
  const normalize = (value) => String(value || "").trim().replace(/^W\//iu, "");
  const expected = normalize(etag);
  const values = String(header || "").split(",").map((value) => value.trim());
  return values.includes("*") || values.some((value) => normalize(value) === expected);
}

module.exports = { createStaticResponder };
