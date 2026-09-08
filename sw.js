const CACHE='winning-url-manager-share-v9-nova-file-types';
const ASSETS=['./','./index.html','./share.html','./nova-tools.js','./manifest.webmanifest?v=2','./icon-any.png','./icon-maskable.png'];
const NOVA_DB='winning-url-manager-nova';
const NOVA_STORE='backups';

function openNovaDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(NOVA_DB,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(NOVA_STORE))db.createObjectStore(NOVA_STORE,{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('NOVA保存領域を開けませんでした。'));
  });
}

async function storeNovaFile(file){
  const db=await openNovaDb();
  const id=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
  const record={
    id,fileName:file.name||`nova-${Date.now()}.novabackup`,fileSize:file.size||0,
    mimeType:file.type||'application/octet-stream',lastModified:file.lastModified||Date.now(),
    blob:file,deviceName:'',maxAccounts:150,receivedAt:Date.now(),shared:true
  };
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(NOVA_STORE,'readwrite');tx.objectStore(NOVA_STORE).put(record);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=tx.onerror;
  });
  db.close();return id;
}

async function handleShareTarget(request){
  try{
    const data=await request.formData();
    const file=data.get('novaBackup');
    if(file instanceof File&&file.size>0){
      const validName=String(file.name||'').toLowerCase().endsWith('.novabackup');
      if(!validName||file.size>40*1024*1024){
        return Response.redirect(new URL('./index.html#nova',self.location.href),303);
      }
      await storeNovaFile(file);
      return Response.redirect(new URL('./index.html#nova',self.location.href),303);
    }
    const params=new URLSearchParams();
    for(const key of ['title','text','url']){
      const value=data.get(key);if(typeof value==='string'&&value)params.set(key,value);
    }
    return Response.redirect(new URL(`./share.html?${params}`,self.location.href),303);
  }catch(error){
    return Response.redirect(new URL('./index.html#nova',self.location.href),303);
  }
}

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
  const url=new URL(req.url);
  if(req.method==='POST'&&url.origin===self.location.origin&&url.pathname.endsWith('/share.html')){
    event.respondWith(handleShareTarget(req));
    return;
  }
  if(req.method!=='GET') return;
  event.respondWith(
    fetch(req).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html')))
  );
});
