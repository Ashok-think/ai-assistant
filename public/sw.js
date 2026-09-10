/*
 * Jarvish service worker — minimal, network-first.
 * Its job is to (a) make the app installable on Android/Chrome (an install prompt requires a
 * registered SW with a fetch handler) and (b) serve a cached shell if the network drops.
 * It deliberately does NOT cache API responses (chat/tts/state) so replies are always live.
 */
const CACHE = "jarvish-shell-v1";
const SHELL = ["/", "/characters", "/settings", "/memory", "/skills", "/docs", "/favicon.svg", "/icon.svg"];

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
  // Never cache API or streaming routes — those must hit the server every time.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful navigations / static assets for offline fallback.
        if (res.ok && (req.mode === "navigate" || url.pathname.startsWith("/_next/") || SHELL.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
  );
});
