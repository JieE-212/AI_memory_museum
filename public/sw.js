"use strict";

const CACHE_PREFIX = "time-isle-public-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v10.0.0`;
const OFFLINE_URL = "/offline.html";
const SHELL_ASSETS = Object.freeze([
  OFFLINE_URL,
  "/pwa.css?v=10.0.0",
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
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (!CACHEABLE_PATHS.has(url.pathname)) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)));
});
