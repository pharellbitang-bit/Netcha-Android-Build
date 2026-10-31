'use strict';

const CACHE_NAME = 'netcha-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/netcha.svg'];

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
      .then(keys => Promise.all(keys.filter(key => key.startsWith('netcha-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Les données personnelles, sessions, messages et endpoints API restent toujours réseau uniquement.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/', copy));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match('/');
        return cached || new Response(
          '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Netcha hors ligne</title><body style="font-family:system-ui;background:#0b1018;color:#f4f8ff;padding:2rem"><h1>Netcha</h1><p>Connexion indisponible. Réessaie dès que ton réseau revient.</p></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
        );
      })
    );
    return;
  }

  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
