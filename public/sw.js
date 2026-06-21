const CACHE = "finance-tracker-v2";

// On install, cache everything Vite builds
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Cache the root page
      await cache.add("/");
      // Vite asset manifest gives us all built files
      try {
        const res = await fetch("/asset-manifest.json");
        if (res.ok) {
          const manifest = await res.json();
          const urls = Object.values(manifest).filter(v => typeof v === "string" && v.startsWith("/"));
          await cache.addAll(urls);
        }
      } catch {}
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Always skip non-GET, cross-origin API calls (Supabase, exchange rates, Google auth)
  if (e.request.method !== "GET") return;
  const isExternal =
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("er-api.com") ||
    url.hostname.includes("google.com");
  if (isExternal) return;

  // For same-origin requests: network first, cache fallback
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("/")))
  );
});
