const CACHE='winning-url-manager-share-v44-dock-order';
const ASSETS=['./','./index.html','./share.html','./home-layout.html','./home-layout-edit.html','./home-layout-read.html','./home-layout-admin.html','./home-layout-monthly-history.html','./fonts/Corporate-Logo-Rounded-Bold-ver3.woff2','./manifest.webmanifest?v=4','./icon-any.png','./icon-maskable.png'];
const BACKUP_DB='winning-url-manager-home-layout';
const BACKUP_STORE='backups';
const OLD_NOVA_DB='winning-url-manager-nova';

function openBackupDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(BACKUP_DB,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(BACKUP_STORE))db.createObjectStore(BACKUP_STORE,{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('バックアップ保存領域を開けませんでした。'));
  });
}

async function storeBackupFile(file){
  const db=await openBackupDb();
  const id=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
  const record={
    id,kind:'source',fileName:file.name||`backup-${Date.now()}.novabackup`,fileSize:file.size||0,
    mimeType:file.type||'application/octet-stream',lastModified:file.lastModified||Date.now(),
    blob:file,receivedAt:Date.now(),shared:true
  };
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(BACKUP_STORE,'readwrite');tx.objectStore(BACKUP_STORE).put(record);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=tx.onerror;
  });
  db.close();return id;
}

async function handleShareTarget(request){
  try{
    const data=await request.formData();
    const file=data.get('backupFile')||data.get('novaBackup');
    if(file instanceof File&&file.size>0){
      const validName=String(file.name||'').toLowerCase().endsWith('.novabackup');
      if(!validName||file.size>40*1024*1024){
        return Response.redirect(new URL('./home-layout.html#file-error',self.location.href),303);
      }
      await storeBackupFile(file);
      return Response.redirect(new URL('./home-layout.html#received',self.location.href),303);
    }
    const params=new URLSearchParams();
    for(const key of ['title','text','url']){
      const value=data.get(key);if(typeof value==='string'&&value)params.set(key,value);
    }
    return Response.redirect(new URL(`./share.html?${params}`,self.location.href),303);
  }catch(error){
    return Response.redirect(new URL('./home-layout.html#file-error',self.location.href),303);
  }
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
      new Promise(resolve=>{
        const request=indexedDB.deleteDatabase(OLD_NOVA_DB);
        request.onsuccess=request.onerror=request.onblocked=()=>resolve();
      })
    ])
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
