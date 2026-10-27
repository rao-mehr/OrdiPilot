/* OrdiPilot Service Worker · V6.16
   Seit V6.12 enthält index.html alle Korrekturen selbst. Der Service Worker verändert
   die Seite nicht mehr (früher wurde v6113-hotfix.js zur Laufzeit eingeschleust). */
const CACHE="ordipilot-v6-16-0";
const STATIC=[
  "./index.html",
  "./manifest.webmanifest",
  "./icons/ordipilot-v616-180.png",
  "./icons/ordipilot-v616-192.png",
  "./icons/ordipilot-v616-512.png"
];

self.addEventListener("install",event=>{
  // Einzeln cachen: fehlt eine Datei, darf das Update trotzdem nicht scheitern
  event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(STATIC.map(u=>cache.add(u)))).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  // Dropbox und andere Fremd-APIs nie aus dem Cache bedienen.
  if(url.origin!==self.location.origin&&!/cdn\.jsdelivr\.net$/.test(url.hostname))return;
  if(event.request.mode==="navigate"){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:"no-store"});
        if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("./index.html",copy)).catch(()=>{})}
        return response;
      }catch(error){
        const cached=await caches.match("./index.html")||await caches.match("./");
        if(cached)return cached;
        throw error;
      }
    })());
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{})}
    return response;
  })));
});
