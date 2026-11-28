"use strict";

const PREFIX = "transit-fuel-pwa-";
const CACHE_NAME = PREFIX + "1.0.4-multilang-catalog";
const ASSETS = [
  "./", "./index.html", "./manifest.json", "./calculations.js", "./storage.js",
  "./company.js", "./app.js", "./i18n.js", "./i18n-catalog.js", "./privacy.html", "./icon-192.png", "./icon-512.png",
  "./icon-192.svg", "./icon-512.svg"
];
const assetPaths = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).pathname));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !assetPaths.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request, {ignoreSearch: true});
    return cached || fetch(event.request);
  })());
});
