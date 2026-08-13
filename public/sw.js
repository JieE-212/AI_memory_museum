"use strict";

const CACHE_PREFIX = "time-isle-public-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v17.2.2`;
const OFFLINE_URL = "/offline.html";
const SHELL_ASSETS = Object.freeze([
  OFFLINE_URL,
  "/pwa.css?v=17.2.2",
  "/assets/time-isle-icon.svg"
]);
const CACHEABLE_PATHS = new Set(SHELL_ASSETS.map((value) => new URL(value, self.location.origin).pathname));
const PRIVATE_PATH_PREFIXES = Object.freeze(["/api/", "/api/media/", "/api/voice/"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))))
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PRIVATE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request)
      .then(async (response) => {
        if (![502, 503, 504].includes(response.status)) return response;
        return (await matchOffline()) || response;
      })
      .catch(async () => (await matchOffline()) || new Response(
        "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>暂时离线</title><main><h1>暂时无法连接时屿</h1><p>网络恢复后刷新即可，私人馆藏没有被放进离线缓存。</p></main></html>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
      )));
    return;
  }

  if (!CACHEABLE_PATHS.has(url.pathname)) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)));
});

async function matchOffline() {
  try {
    return await caches.match(OFFLINE_URL);
  } catch {
    return null;
  }
}
