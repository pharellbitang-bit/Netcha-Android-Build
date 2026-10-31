'use strict';

// Cache local de l'interface : affichage immédiat, mise à jour réseau en arrière-plan.
// Les API, sessions, messages et données privées ne sont jamais mis en cache.
const CACHE_NAME = 'netcha-shell-v2';
const APP_SHELL = ['/', '/index.html', '/auth.js', '/manifest.webmanifest', '/icons/netcha.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('netcha-shell-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function actualiserCache(cache, request, alias) {
  return fetch(request).then(response => {
    if (response && response.ok) {
      const copie = response.clone();
      const ecritures = [cache.put(request, copie)];
      (alias || []).forEach(path => ecritures.push(cache.put(path, response.clone())));
      return Promise.all(ecritures).then(() => response);
    }
    return response;
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Jamais de cache pour les données utilisateur ou les endpoints dynamiques.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('/') || await cache.match('/index.html');
      const miseAJour = actualiserCache(cache, request, ['/','/index.html']).catch(() => null);
      if (cached) {
        event.waitUntil(miseAJour.then(() => undefined));
        return cached;
      }
      const frais = await miseAJour;
      return frais || new Response(
        '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Netcha hors ligne</title><body style="font-family:system-ui;background:#0b1018;color:#f4f8ff;padding:2rem"><h1>Netcha</h1><p>Connexion indisponible. Réessaie dès que ton réseau revient.</p></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
      );
    })());
    return;
  }

  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const miseAJour = actualiserCache(cache, request).catch(() => null);
      if (cached) {
        event.waitUntil(miseAJour.then(() => undefined));
        return cached;
      }
      const frais = await miseAJour;
      return frais || Response.error();
    })());
  }
});
