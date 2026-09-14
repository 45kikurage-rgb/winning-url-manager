(()=>{
  const RETIRED_ROLE_KEY='home-layout-device-role-v1';

  // サブ端末モードは廃止。既存ページとの互換性のため、常に全機能利用可を公開する。
  window.LayoutDeviceAccess=Object.freeze({
    deviceId:'',
    isRestricted:false,
    isAllowedPage:true
  });

  try{localStorage.removeItem(RETIRED_ROLE_KEY)}catch{}

  document.addEventListener('DOMContentLoaded',()=>{
    delete document.documentElement.dataset.layoutDevice;
    document.querySelectorAll('[data-main-device-only]').forEach(element=>element.hidden=false);
    document.querySelectorAll('[data-layout-device-only]').forEach(element=>element.hidden=true);
  },{once:true});
})();
