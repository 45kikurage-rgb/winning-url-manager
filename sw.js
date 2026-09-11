const CACHE='winning-url-manager-share-v47-initial-draw-ranges';
const ASSETS=['./','./index.html','./share.html','./home-layout.html','./home-layout-edit.html','./home-layout-read.html','./home-layout-admin.html','./home-layout-monthly-history.html','./fonts/Corporate-Logo-Rounded-Bold-ver3.woff2','./manifest.webmanifest?v=4','./icon-any.png','./icon-maskable.png'];
const BACKUP_DB='winning-url-manager-home-layout';
const BACKUP_STORE='backups';
const OLD_NOVA_DB='winning-url-manager-nova';

const INDEX_DOCK_BEFORE=`<div class="bottomDock">
  <nav class="dockNavRow" aria-label="配置・画面操作">
    <a class="dockNavBtn dockNavPrimary" href="./home-layout.html">配置データ変更</a>
    <a class="dockNavBtn dockNavPrimary" href="./home-layout-admin.html">配置管理画面</a>
    <button id="dockReloadBtn" class="dockNavBtn dockNavReload" type="button">画面更新</button>
  </nav>
  <div class="dockControlGrid" aria-live="polite">
    <button id="dedupRunBtn" class="dedupRunBtn dedupDockBtn" type="button"><span class="dedupRunCount">--件</span><span>重複確認</span></button>
    <button id="revenueUpdateBtn" class="revenueUpdateBtn" type="button">収益更新</button>
    <button id="moreOperationsBtn" class="moreOperationsBtn" type="button">▶ その他操作</button>
  </div>`;

const INDEX_DOCK_AFTER=`<div class="bottomDock">
  <nav class="dockNavRow" aria-label="配置・画面操作">
    <a class="dockNavBtn dockNavPrimary" href="./home-layout.html">配置データ変更</a>
    <button id="dedupRunBtn" class="dedupRunBtn dedupDockBtn" type="button"><span class="dedupRunCount">--件</span><span>重複確認</span></button>
    <button id="dockReloadBtn" class="dockNavBtn dockNavReload" type="button">画面更新</button>
  </nav>
  <div class="dockControlGrid" aria-live="polite">
    <a class="dockNavBtn dockNavPrimary" href="./home-layout-admin.html">配置管理画面</a>
    <button id="revenueUpdateBtn" class="revenueUpdateBtn" type="button">収益更新</button>
    <button id="moreOperationsBtn" class="moreOperationsBtn" type="button">▶ その他操作</button>
  </div>`;

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

async function transformIndexDock(response){
  if(!response)return response;
  const text=await response.text();
  const transformed=text.includes(INDEX_DOCK_BEFORE)?text.replace(INDEX_DOCK_BEFORE,INDEX_DOCK_AFTER):text;
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(transformed,{status:response.status,statusText:response.statusText,headers});
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
  if(url.origin===self.location.origin&&(url.pathname.endsWith('/')||url.pathname.endsWith('/index.html'))){
    event.respondWith((async()=>{
      try{return await transformIndexDock(await fetch(req))}
      catch{
        const cached=await caches.match(req)||await caches.match('./index.html');
        return transformIndexDock(cached);
      }
    })());
    return;
  }
  event.respondWith(
    fetch(req).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html')))
  );
});
