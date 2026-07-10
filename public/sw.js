/**
 * ParentShield Offline Portal Service Worker
 * Durable static/bundle caching tailored for fast loads in areas with poor cellular reception (courtrooms).
 */

const CACHE_NAME = "opa-courtroom-cache-v3";

const OFFLINE_URLS = [
  "/",
  "/index.html",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;750&family=JetBrains+Mono:wght@500&display=swap"
];

// Pre-cache core shell resources on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[OPA SW] Performing initial pre-caching of shell and fonts");
      return cache.addAll(OFFLINE_URLS);
    })
  );
  // Force activating SW immediately to ensure immediate protection
  self.skipWaiting();
});

// Purge obsolete caches on activation
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[OPA SW] Purging stale offline cache key:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  // Claim active clients immediately
  self.clients.claim();
});

// Intelligent network strategies
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);

  // Never intercept API endpoints to prevent blocking AI or transcribing backends
  if (requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  // 1. Navigation & HTML Requests: Network-First to prevent stale index.html chunk mismatch (white screens)
  const isNavigation = event.request.mode === "navigate" || 
                       requestUrl.pathname === "/" || 
                       requestUrl.pathname === "/index.html" || 
                       requestUrl.pathname.endsWith(".html");

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clonedResponse = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clonedResponse);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          console.log("[OPA SW] Offline. Loading cached shell fallback.");
          return caches.match("/index.html") || caches.match("/");
        })
    );
    return;
  }

  // 2. Static Assets (scripts, styles, fonts, images): Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return immediately from cache, and asynchronously refresh cache in background
        const isAsset = 
          event.request.destination === "script" ||
          event.request.destination === "style" ||
          event.request.destination === "font" ||
          requestUrl.origin === "https://fonts.gstatic.com";

        if (isAsset) {
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, networkResponse);
                });
              }
            })
            .catch(() => {
              // Ignore background update errors when offline
            });
        }
        return cachedResponse;
      }

      // If not cached, fetch from network and cache dynamically if cacheable
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const isCacheable =
            event.request.destination === "script" ||
            event.request.destination === "style" ||
            event.request.destination === "image" ||
            event.request.destination === "font" ||
            requestUrl.origin === "https://fonts.gstatic.com" ||
            requestUrl.pathname.endsWith(".js") ||
            requestUrl.pathname.endsWith(".css");

          if (isCacheable) {
            const clonedResponse = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clonedResponse);
            });
          }

          return networkResponse;
        })
        .catch((err) => {
          throw err;
        });
    })
  );
});
