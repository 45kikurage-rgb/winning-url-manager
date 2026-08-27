const CACHE='winning-url-manager-share-v2';
const ASSETS=['./','./index.html','./share.html','./manifest.webmanifest','./icon-any.png','./icon-maskable.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  event.respondWith(
    fetch(req).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html')))
  );
});