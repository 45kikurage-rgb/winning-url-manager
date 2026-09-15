(()=>{
  const STORAGE_KEY='winning-url-manager-button-display-mode-v1';
  const FULL='full';
  const PARTIAL='partial';
  const CONTROL_PARAM='button-controls';

  const readMode=()=>{
    try{return localStorage.getItem(STORAGE_KEY)===PARTIAL?PARTIAL:FULL}catch{return FULL}
  };
  const saveMode=mode=>{
    const normalized=mode===PARTIAL?PARTIAL:FULL;
    try{localStorage.setItem(STORAGE_KEY,normalized)}catch{}
    return normalized;
  };
  const applyRootMode=mode=>{
    document.documentElement.dataset.buttonDisplay=mode;
  };

  let mode=readMode();
  const pathname=String(location.pathname||'');
  const isIndexPage=pathname.endsWith('/')||pathname.endsWith('/index.html');
  const isLayoutPage=pathname.endsWith('/home-layout.html');
  const currentUrl=new URL(location.href);
  const allowButtonControls=isIndexPage&&currentUrl.searchParams.get(CONTROL_PARAM)==='1';

  if(allowButtonControls){
    currentUrl.searchParams.delete(CONTROL_PARAM);
    const query=currentUrl.searchParams.toString();
    history.replaceState(null,'',currentUrl.pathname+(query?`?${query}`:'')+currentUrl.hash);
  }else if(isIndexPage&&mode===PARTIAL){
    location.replace(new URL('./home-layout.html',location.href).href);
    return;
  }

  applyRootMode(mode);

  const applyControls=()=>{
    applyRootMode(mode);
    const toggle=document.querySelector('#buttonDisplayModeBtn');
    if(toggle){
      toggle.textContent=mode===PARTIAL?'ボタン一部表示':'ボタン全部表示';
      toggle.setAttribute('aria-pressed',mode===PARTIAL?'true':'false');
    }
    if(isLayoutPage&&mode===PARTIAL){
      const back=document.querySelector('.back[href="./index.html"]');
      if(back)back.href='./index.html?button-controls=1';
    }
  };

  const toggleMode=()=>{
    mode=saveMode(mode===PARTIAL?FULL:PARTIAL);
    applyControls();
    return mode;
  };

  window.ButtonDisplayMode=Object.freeze({
    getMode:()=>mode,
    setMode:next=>{
      mode=saveMode(next);
      applyControls();
      return mode;
    },
    toggle:toggleMode
  });

  document.addEventListener('DOMContentLoaded',()=>{
    applyControls();
    const toggle=document.querySelector('#buttonDisplayModeBtn');
    if(toggle)toggle.addEventListener('click',toggleMode);
  },{once:true});
})();
