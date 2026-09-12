/*
 * Jarvish service worker — minimal, network-first.
 * Its job is to (a) make the app installable on Android/Chrome (an install prompt requires a
 * registered SW with a fetch handler) and (b) retain public static assets if the network drops.
 * Account pages are deliberately network-only to prevent private data surviving sign-out.
 * It deliberately does NOT cache API responses (chat/tts/state) so replies are always live.
 */
const CACHE = "jarvish-static-v2";
const SHELL = ["/favicon.svg", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never cache HTML, RSC payloads, authenticated routes, or third-party requests.
  if (url.origin !== self.location.origin || !(url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname))) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful navigations / static assets for offline fallback.
        if (res.ok && !res.redirected && !/private|no-store/i.test(res.headers.get("cache-control") || "")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error())),
  );
});
