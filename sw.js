const CACHE_NAME = "tasmota-control-v1.1.0";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e)=>{
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>
      Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e)=>{
  const url = new URL(e.request.url);
  // Nunca cachear ni interceptar llamadas a dispositivos Tasmota en la LAN
  if(url.origin !== self.location.origin){
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached=>
      cached || fetch(e.request).then(res=>{
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(e.request, clone));
        return res;
      }).catch(()=>cached)
    )
  );
});
