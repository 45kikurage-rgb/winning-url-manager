(()=>{
  const STORAGE_KEY='home-layout-initial-device';
  const raw=(()=>{try{return localStorage.getItem(STORAGE_KEY)||''}catch{return ''}})();
  const numeric=/^\d{1,2}$/.test(raw)?Number(raw):NaN;
  const deviceId=Number.isInteger(numeric)&&numeric>=1&&numeric<=15?String(numeric).padStart(2,'0'):'';
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const layoutPages=new Set(['home-layout.html','home-layout-edit.html','home-layout-read.html']);

  window.LayoutDeviceAccess=Object.freeze({
    deviceId,
    isRestricted:Boolean(deviceId),
    isAllowedPage:!deviceId||layoutPages.has(page)
  });

  if(deviceId&&!layoutPages.has(page)){
    location.replace(new URL('./home-layout.html',location.href).href);
    return;
  }

  if(!deviceId)return;
  document.documentElement.dataset.layoutDevice=deviceId;
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-main-device-only]').forEach(element=>element.hidden=true);
    if(page==='home-layout.html'){
      const back=document.querySelector('.back[href="./index.html"]');
      if(back){
        back.removeAttribute('href');
        back.textContent=`端末 ${deviceId}`;
        back.setAttribute('aria-label',`登録端末 ${deviceId}`);
      }
    }
  },{once:true});
})();
