(()=>{
  const SETTINGS_KEY='home-layout-settings-v1';
  const LEGACY_STORAGE_KEY='home-layout-initial-device';
  const raw=(()=>{
    try{
      const settings=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
      return String(settings?.device||localStorage.getItem(LEGACY_STORAGE_KEY)||'');
    }catch{
      try{return localStorage.getItem(LEGACY_STORAGE_KEY)||''}catch{return ''}
    }
  })();
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
    document.querySelectorAll('[data-layout-device-only]').forEach(element=>element.hidden=false);
    if(page==='home-layout.html'){
      const back=document.querySelector('.back[href="./index.html"]');
      if(back){
        back.removeAttribute('href');
        back.textContent=`端末 ${deviceId}`;
        back.setAttribute('aria-label',`登録端末 ${deviceId}`);
      }
      const lockButton=document.querySelector('[data-open-security-settings]');
      if(lockButton)lockButton.href='intent:#Intent;action=android.settings.SECURITY_SETTINGS;end';
    }
  },{once:true});
})();
