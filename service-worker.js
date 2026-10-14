const CACHE="ordipilot-v6-11-3";
const STATIC=[
  "./index.html",
  "./manifest.webmanifest",
  "./v6113-hotfix.js",
  "./icons/ordipilot-v611-180.png",
  "./icons/ordipilot-v611-192.png",
  "./icons/ordipilot-v611-512.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

async function injectHotfix(response){
  if(!response)return response;
  const headers=new Headers(response.headers);
  const type=headers.get("content-type")||"";
  if(!type.includes("text/html"))return response;
  let html=await response.text();
  html=html
    .replace(/manifest\.webmanifest\?v=6110/g,"manifest.webmanifest?v=6113")
    .replace(/ordipilot-v611-180\.png\?v=6110/g,"ordipilot-v611-180.png?v=6113");
  if(!html.includes("v6113-hotfix.js")){
    html=html.replace(/<\/body>/i,'<script src="./v6113-hotfix.js?v=6113"></script></body>');
  }
  headers.set("content-type","text/html; charset=utf-8");
  headers.delete("content-length");
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  if(event.request.mode==="navigate"){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:"no-store"});
        if(response.ok){
          const raw=response.clone();
          caches.open(CACHE).then(cache=>cache.put("./index.html",raw)).catch(()=>{});
        }
        return injectHotfix(response);
      }catch(error){
        const cached=await caches.match("./index.html")||await caches.match("./");
        if(cached)return injectHotfix(cached);
        throw error;
      }
    })());
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response&&response.ok){
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
    }
    return response;
  })));
});
