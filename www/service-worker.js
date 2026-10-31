/* Netcha PWA shell cache. API calls and user data are never cached. */
const CACHE_NAME = "netcha-shell-2026-10-31-v1";
const BASE_PATH = new URL("./", self.registration.scope).pathname;
const SHELL = [
  BASE_PATH,
  BASE_PATH + "index.html",
  BASE_PATH + "auth.js",
  BASE_PATH + "manifest.webmanifest",
  BASE_PATH + "legal.html",
  BASE_PATH + "icons/netcha.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("netcha-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE_PATH)) return;

  // HTML navigation: network first so deployments appear promptly, cached shell as fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(BASE_PATH, response.clone()));
          return response;
        })
        .catch(() => caches.match(BASE_PATH).then(cached => cached || caches.match(BASE_PATH + "index.html")))
    );
    return;
  }

  // Static application files only. API traffic is sent to Railway from the page and is cross-origin.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      });
      return cached || network;
    })
  );
});
