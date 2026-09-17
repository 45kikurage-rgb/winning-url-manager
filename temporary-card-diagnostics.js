(() => {
  'use strict';

  let urlTapState=null;

  function installUrlTap(){
    const area=document.getElementById('urlArea');
    if(!area||area.dataset.urlTapRestore==='1')return;
    area.dataset.urlTapRestore='1';

    area.addEventListener('pointerdown',event=>{
      const urlEl=event.target.closest('.url');
      if(!urlEl)return;
      urlTapState={
        urlEl,
        x:event.clientX,
        y:event.clientY,
        started:performance.now(),
        moved:false
      };
    },true);

    area.addEventListener('pointermove',event=>{
      if(!urlTapState)return;
      if(Math.hypot(event.clientX-urlTapState.x,event.clientY-urlTapState.y)>10){
        urlTapState.moved=true;
      }
    },true);

    area.addEventListener('pointercancel',()=>{urlTapState=null},true);

    area.addEventListener('click',event=>{
      const urlEl=event.target.closest('.url');
      if(!urlEl)return;

      const state=urlTapState;
      urlTapState=null;
      if(state&&(state.moved||performance.now()-state.started>450))return;

      const value=String(urlEl.textContent||'').trim();
      let url;
      try{url=new URL(value)}catch{return}
      if(!['http:','https:'].includes(url.protocol))return;

      event.preventDefault();
      event.stopPropagation();
      const opened=window.open(url.href,'_blank','noopener');
      if(!opened)location.href=url.href;
    },true);
  }

  function installStyle(){
    if(document.getElementById('urlTapRestoreStyle'))return;
    const style=document.createElement('style');
    style.id='urlTapRestoreStyle';
    style.textContent='.url{cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px}';
    document.head.appendChild(style);
  }

  const observer=new MutationObserver(()=>installUrlTap());
  function start(){
    installStyle();
    observer.observe(document.body,{childList:true,subtree:true});
    installUrlTap();
    setInterval(installUrlTap,1200);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
