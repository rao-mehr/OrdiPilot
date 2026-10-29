/* OrdiPilot Service Worker · V7.1
   Seit V6.12 enthält die App alle Korrekturen selbst (seit dem Umbau in css/ und js/). Der Service Worker verändert
   die Seite nicht mehr (früher wurde v6113-hotfix.js zur Laufzeit eingeschleust). */
const CACHE="ordipilot-v7-2-0";
const V="720"; // = ?v= in index.html
const FILES=[
  "css/base.css","css/v68.css","css/v611.css",
  "js/boot.js","js/app.js","js/v68.js","js/v69.js","js/v6103-parking-fix.js","js/v611.js","js/v6102-calendar-batch-fix.js",
  "js/v612-recipients.js","js/v612-sync-core.js","js/v614-tax.js","js/v615-ui.js","js/v616-auto.js","js/v617-send.js","js/v619-reserve.js","js/v710-ki-erinnerung.js","js/v720-wacht.js","js/main.js"
];
const STATIC=[
  "./index.html",
  "./manifest.webmanifest?v="+V,
  "./icons/ordipilot-v6161-180.png?v="+V,
  "./icons/ordipilot-v6161-192.png",
  "./icons/ordipilot-v6161-512.png",
  ...FILES.map(f=>"./"+f+"?v="+V)
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
