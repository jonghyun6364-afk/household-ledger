const CACHE_NAME = "inventory-cache-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("inventory-cache-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheFirst(request) {
  return caches.match(request).then((cached) => cached || fetch(request).then((res) => {
    if (res && (res.ok || res.type === "opaque")) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(request, copy));
    }
    return res;
  }));
}

// App files: network first so updates land right away, cache when offline.
// no-cache revalidates with the server so the page never pairs new HTML with a stale script.
function networkFirst(request) {
  return fetch(request, { cache: "no-cache" }).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(request, copy));
    }
    return res;
  }).catch(() => caches.match(request, { ignoreSearch: true }));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event.request));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"
             || (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))) {
    event.respondWith(cacheFirst(event.request));
  }
  // Everything else (Firestore, Google sign-in) goes straight to the network
});
