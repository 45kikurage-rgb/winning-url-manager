importScripts('./layout-backup-share.js?v=20260919-nova-open-v1');

const CACHE="winning-url-manager-20260920-client-ver-fix";
const ASSETS=['./device-access.js?v=7','./button-display-mode.js?v=1','./layout-account-reset-ui.js?v=2','./revenue-deduction.js?v=2','./layout-backup-share.js?v=20260919-nova-open-v1','./temporary-card-tools-v3.js?v=20260917-v3','./temporary-card-diagnostics.js?v=20260918-v2','./','./index.html','./share.html','./home-layout.html','./home-layout-edit.html','./home-layout-marker-core.js?v=13','./home-layout-read.html','./home-layout-admin.html','./home-layout-monthly-history.html','./fonts/Corporate-Logo-Rounded-Bold-ver3.woff2','./manifest.webmanifest?v=20260919-nova-open-v1','./icon-transparent-192.png?v=20260914-white-splash','./icon-transparent-512.png?v=20260914-white-splash','./icon-maskable.png?v=20260914-white-splash'];

const INDEX_DOCK_BEFORE=`<div class="bottomDock">
  <nav class="dockNavRow" aria-label="配置・画面操作">
    <a class="dockNavBtn dockNavPrimary" href="./home-layout.html">画面配置</a>
    <a class="dockNavBtn dockNavPrimary" href="./home-layout-admin.html">配置管理</a>
    <button id="dockReloadBtn" class="dockNavBtn dockNavReload" type="button">画面更新</button>
  </nav>
  <div class="dockControlGrid" aria-live="polite">
    <button id="dedupRunBtn" class="dedupRunBtn dedupDockBtn" type="button"><span class="dedupRunCount">--件</span><span>重複確認</span></button>
    <button id="revenueUpdateBtn" class="revenueUpdateBtn" type="button">収益更新</button>
    <button id="moreOperationsBtn" class="moreOperationsBtn" type="button">▶ その他操作</button>
  </div>`;

const INDEX_DOCK_AFTER=`<div class="bottomDock">
  <nav class="dockNavRow" aria-label="配置・画面操作">
    <a class="dockNavBtn dockNavPrimary" href="./home-layout.html">画面配置</a>
    <button id="dedupRunBtn" class="dedupRunBtn dedupDockBtn" type="button"><span class="dedupRunCount">--件</span><span>重複確認</span></button>
    <button id="dockReloadBtn" class="dockNavBtn dockNavReload" type="button">画面更新</button>
  </nav>
  <div class="dockControlGrid" aria-live="polite">
    <a class="dockNavBtn dockNavPrimary" href="./home-layout-admin.html">配置管理</a>
    <button id="revenueUpdateBtn" class="revenueUpdateBtn" type="button">収益更新</button>
    <button id="moreOperationsBtn" class="moreOperationsBtn" type="button">▶ その他操作</button>
  </div>`;

function shareApi(){
  return self.LayoutBackupShare;
}

function asShareFile(value){
  if(!value)return null;
  if(typeof File!=='undefined'&&value instanceof File)return value;
  if(typeof value==='object'&&Number(value.size||0)>0&&(value.name||value.fileName))return value;
  return null;
}

async function handleShareTarget(request){
  try{
    const data=await request.formData();
    const file=asShareFile(data.get('backupFile')||data.get('novaBackup'));
    if(file){
      const api=shareApi();
      if(!api||!api.isNovaBackupFile(file)){
        return Response.redirect(new URL('./share.html?backup_error=1',self.location.href),303);
      }
      const id=await api.storePendingShare(file);
      return Response.redirect(new URL(`./share.html?backup=${encodeURIComponent(id)}`,self.location.href),303);
    }
    const params=new URLSearchParams();
    for(const key of ['title','text','url']){
      const value=data.get(key);if(typeof value==='string'&&value)params.set(key,value);
    }
    return Response.redirect(new URL(`./share.html?${params}`,self.location.href),303);
  }catch(error){
    return Response.redirect(new URL('./share.html?backup_error=1',self.location.href),303);
  }
}

async function transformIndexDock(response){
  if(!response)return response;
  const text=await response.text();
  let transformed=text.includes(INDEX_DOCK_BEFORE)?text.replace(INDEX_DOCK_BEFORE,INDEX_DOCK_AFTER):text;
  if(!transformed.includes('temporary-card-tools-v3.js')){
    transformed=transformed.replace('</body>','<script src="./temporary-card-tools-v3.js?v=20260917-v3"></script>\n</body>');
  }
  if(!transformed.includes('temporary-card-diagnostics.js')){
    transformed=transformed.replace('</body>','<script src="./temporary-card-diagnostics.js?v=20260918-v2"></script>\n</body>');
  }
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(transformed,{status:response.status,statusText:response.statusText,headers});
}

async function notifyClients(payload){
  const api=shareApi();
  const note=api?api.notificationFromPushPayload(payload):null;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){
    client.postMessage({type:'layout-backup-push',payload,note});
  }
}

async function handlePush(event){
  let payload={};
  try{payload=event.data?event.data.json():{};}
  catch{
    try{payload={body:await event.data.text()};}catch{payload={};}
  }
  // Must not auto-download. backup-ready may include downloadUrl; only notify / postMessage.
  const api=shareApi();
  const note=api?api.notificationFromPushPayload(payload):{title:'配置バックアップ',options:{body:'更新があります。',data:{}}};
  await notifyClients(payload);
  await self.registration.showNotification(note.title,note.options);
}

async function openOrFocus(url){
  const abs=new URL(url,self.location.href).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){
    if(String(client.url||'').includes('share.html')&&typeof client.focus==='function'){
      if(typeof client.navigate==='function'){
        try{await client.navigate(abs);}catch(_){}
      }
      return client.focus();
    }
  }
  if(self.clients.openWindow)return self.clients.openWindow(abs);
}

async function handleNotificationClick(event){
  const data=(event.notification&&event.notification.data)||{};
  const api=shareApi();
  const wantDownload=event.action==='download'&&data.canDownload;
  const target=api?api.notificationClickUrl(data,{download:wantDownload}):'./share.html';
  await openOrFocus(target);
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

self.addEventListener('push',event=>{
  event.waitUntil(handlePush(event));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});
