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

  const publishAccess=currentDeviceId=>{
    window.LayoutDeviceAccess=Object.freeze({
      deviceId:currentDeviceId,
      isRestricted:false,
      isAllowedPage:true
    });
  };
  publishAccess(deviceId);

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
    const lockButton=document.querySelector('[data-open-security-settings]');

    const applyRoleUI=currentDeviceId=>{
      publishAccess(currentDeviceId);
      if(currentDeviceId){
        document.documentElement.dataset.layoutDevice=currentDeviceId;
        document.querySelectorAll('[data-main-device-only]').forEach(element=>element.hidden=false);
        document.querySelectorAll('[data-layout-device-only]').forEach(element=>element.hidden=false);
        if(mainState)mainState.hidden=true;
        if(subState)subState.hidden=false;
        if(roleLabel)roleLabel.textContent=`端末 ${currentDeviceId}・サブ機（機能制限なし）`;
        if(lockButton)lockButton.href='intent:#Intent;action=android.settings.SECURITY_SETTINGS;end';
        return;
      }
      delete document.documentElement.dataset.layoutDevice;
      document.querySelectorAll('[data-main-device-only]').forEach(element=>element.hidden=false);
      document.querySelectorAll('[data-layout-device-only]').forEach(element=>element.hidden=true);
      if(mainState)mainState.hidden=false;
      if(subState)subState.hidden=true;
      if(lockButton)lockButton.href='#';
    };

    if(registerButton){
      const current=selectedDevice();
      registerButton.textContent=current?`端末 ${current} をサブ機として設定`:'選択中の端末をサブ機として設定';
      registerButton.addEventListener('click',()=>{
        const next=selectedDevice();
        if(!next){alert('先に端末番号01〜15を選択してください。');return}
        localStorage.setItem(ROLE_KEY,JSON.stringify({role:'sub',deviceId:next}));
        applyRoleUI(next);
      });
    }
    if(unregisterButton)unregisterButton.addEventListener('click',()=>{
      if(!confirm('このスマホのサブ機設定を解除しますか？'))return;
      localStorage.removeItem(ROLE_KEY);
      applyRoleUI('');
    });
    applyRoleUI(deviceId);
  },{once:true});
})();
