(()=>{
  const ROLE_KEY='home-layout-device-role-v1';
  const SETTINGS_KEY='home-layout-settings-v1';
  const LEGACY_STORAGE_KEY='home-layout-initial-device';
  const normalizeDevice=value=>{
    const raw=String(value||'');
    const numeric=/^\d{1,2}$/.test(raw)?Number(raw):NaN;
    return Number.isInteger(numeric)&&numeric>=1&&numeric<=15?String(numeric).padStart(2,'0'):'';
  };
  const registration=(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(ROLE_KEY)||'{}');
      const deviceId=normalizeDevice(saved?.deviceId);
      return saved?.role==='sub'&&deviceId?{role:'sub',deviceId}:null;
    }catch{return null}
  })();
  const deviceId=registration?.deviceId||'';
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

  document.addEventListener('DOMContentLoaded',()=>{
    const selectedDevice=()=>{
      try{
        const settings=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
        return normalizeDevice(settings?.device)||normalizeDevice(localStorage.getItem(LEGACY_STORAGE_KEY))||normalizeDevice(document.querySelector('#initialDevice')?.value);
      }catch{return normalizeDevice(document.querySelector('#initialDevice')?.value)}
    };
    const registerButton=document.querySelector('[data-register-sub-device]');
    const unregisterButton=document.querySelector('[data-unregister-sub-device]');
    const mainState=document.querySelector('[data-device-role-main]');
    const subState=document.querySelector('[data-device-role-sub]');
    const roleLabel=document.querySelector('[data-device-role-label]');

    if(registerButton){
      const current=selectedDevice();
      registerButton.textContent=current?`端末 ${current} をサブ機として設定`:'選択中の端末をサブ機として設定';
      registerButton.addEventListener('click',()=>{
        const next=selectedDevice();
        if(!next){alert('先に端末番号01〜15を選択してください。');return}
        localStorage.setItem(ROLE_KEY,JSON.stringify({role:'sub',deviceId:next}));
        location.reload();
      });
    }
    if(unregisterButton)unregisterButton.addEventListener('click',()=>{
      if(!confirm('このスマホのサブ機設定を解除しますか？'))return;
      localStorage.removeItem(ROLE_KEY);
      location.reload();
    });

    if(!deviceId){
      if(mainState)mainState.hidden=false;
      if(subState)subState.hidden=true;
      return;
    }

    document.documentElement.dataset.layoutDevice=deviceId;
    document.querySelectorAll('[data-main-device-only]').forEach(element=>element.hidden=true);
    document.querySelectorAll('[data-layout-device-only]').forEach(element=>element.hidden=false);
    if(mainState)mainState.hidden=true;
    if(subState)subState.hidden=false;
    if(roleLabel)roleLabel.textContent=`端末 ${deviceId}・サブ機（機能制限中）`;
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
