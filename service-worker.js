const CACHE="ordipilot-v6-10-1";
const ASSETS=["./","./index.html?v=6101","./manifest.webmanifest?v=6101","./icons/ordipilot-v69-180.png","./icons/ordipilot-v69-192.png","./icons/ordipilot-v69-512.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  if(e.request.mode==="navigate"){e.respondWith(fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put("./index.html?v=6101",copy));return resp}).catch(()=>caches.match("./index.html?v=6101")||caches.match("./")));return;}
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp})));
});
