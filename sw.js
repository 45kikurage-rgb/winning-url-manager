importScripts('./layout-backup-share.js?v=20260920-webapk-v2');

const CACHE="winning-url-manager-20260920-webapk-v2";
const ASSETS=[
  './device-access.js?v=7',
  './button-display-mode.js?v=1',
  './layout-account-reset-ui.js?v=2',
  './revenue-deduction.js?v=2',
  './layout-backup-share.js?v=20260920-webapk-v2',
  './temporary-card-tools-v3.js?v=20260920-coupon-gifts-v1',
  './temporary-card-diagnostics.js?v=20260918-v2',
  './',
  './index.html',
  './share.html',
  './home-layout.html',
  './home-layout-edit.html',
  './home-layout-marker-core.js?v=13',
  './home-layout-read.html',
  './home-layout-admin.html',
  './home-layout-monthly-history.html',
  './manifest.json?v=20260920-webapk-v2',
  './manifest.webmanifest?v=20260920-webapk-v2',
  './icon-any-192.png?v=20260920-webapk-v2',
  './icon-any.png?v=20260920-webapk-v2',
  './icon-maskable.png?v=20260920-webapk-v2'
];

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
    let file=asShareFile(data.get('backupFile')||data.get('novaBackup'));
    if(!file && typeof data.values==='function'){
      for(const value of data.values()){
        const candidate=asShareFile(value);
        if(candidate){file=candidate;break;}
      }
    }
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
    // ファイルもURL文字列も無い共有は、誤って当選データ送信に落とさず手動選択へ
    if(![...params.keys()].length){
      return Response.redirect(new URL('./share.html?backup_error=1',self.location.href),303);
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
    transformed=transformed.replace('</body>','<script src="./temporary-card-tools-v3.js?v=20260920-coupon-gifts-v1"></script>\n</body>');
  }
  if(!transformed.includes('temporary-card-diagnostics.js')){
    transformed=transformed.replace('</body>','<script src="./temporary-card-diagnostics.js?v=20260918-v2"></script>\n</body>');
  }
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(transformed,{status:response.status,statusText:response.statusText,headers});
}

function isNavigationRequest(request){
  if(!request)return false;
  if(request.mode==='navigate')return true;
  if(request.destination==='document')return true;
  if(!request.destination){
    const accept=(request.headers&&request.headers.get&&request.headers.get('accept'))||'';
    if(accept.includes('text/html'))return true;
  }
  return false;
}

function isIndexPath(url){
  return !!url && (url.pathname.endsWith('/')||url.pathname.endsWith('/index.html'));
}

function shouldFallbackToIndex(request,url){
  return isNavigationRequest(request)&&( !url || url.origin===self.location.origin );
}

async function precacheAssets(cacheNames){
  const cache=await caches.open(cacheNames||CACHE);
  await Promise.all(ASSETS.map(async(url)=>{
    try{
      const response=await fetch(url,{cache:'no-store'});
      if(response&&response.ok)await cache.put(url,response);
    }catch(_){}
  }));
  return cache;
}

async function activateAndClaim(){
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
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
  event.waitUntil(precacheAssets().then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(activateAndClaim());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method==='POST'&&url.origin===self.location.origin&&url.pathname.endsWith('/share.html')){
    event.respondWith(handleShareTarget(req));
    return;
  }
  if(req.method!=='GET') return;
  if(url.origin===self.location.origin&&isNavigationRequest(req)&&isIndexPath(url)){
    event.respondWith((async()=>{
      try{return await transformIndexDock(await fetch(req,{cache:'no-store'}))}
      catch{
        const cached=await caches.match(req)||await caches.match('./index.html')||await caches.match('./');
        return cached?transformIndexDock(cached):new Response('',{status:504,statusText:'offline'});
      }
    })());
    return;
  }
  if(shouldFallbackToIndex(req,url)){
    event.respondWith(
      fetch(req,{cache:'no-store'}).catch(async()=>{
        return await caches.match(req)||await caches.match('./index.html')||await caches.match('./')||new Response('',{status:504,statusText:'offline'});
      })
    );
    return;
  }
  event.respondWith(
    fetch(req,{cache:'no-store'}).then(response=>{
      if(response&&response.ok&&url.origin===self.location.origin){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
      }
      return response;
    }).catch(()=>caches.match(req).then(cached=>{
      if(cached)return cached;
      return new Response('',{status:504,statusText:'offline'});
    }))
  );
});

self.addEventListener('push',event=>{
  event.waitUntil(handlePush(event));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});
