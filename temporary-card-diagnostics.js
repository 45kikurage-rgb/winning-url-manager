(() => {
  'use strict';

  const API_BASE='https://winning-url-api.45kikurage.workers.dev';
  const DEBUG_ID='tempCouponDebug';
  const DEBUG_RESULT_ID='tempCouponDebugResult';
  let debugRunning=false;
  let urlTapState=null;

  function supportedKind(value){
    try{
      const url=new URL(String(value||'').trim());
      if(url.protocol==='https:'&&url.hostname==='coupon.sej.co.jp'&&url.pathname==='/order/cpnsp_03.do'&&url.searchParams.has('hansoku_id'))return'seven';
      if(url.protocol==='https:'&&url.hostname==='ncpfa.famima.com'&&url.pathname==='/prd/ebcweb'&&['eKey','cpNo','gyNo'].every(key=>url.searchParams.has(key)))return'familymart';
    }catch{}
    return'';
  }

  function currentRowsSafe(){
    try{return Array.isArray(currentSubmissionRows)?currentSubmissionRows:[]}catch{return[]}
  }

  function installStyle(){
    if(document.getElementById('tempDiagnosticsStyle'))return;
    const style=document.createElement('style');
    style.id='tempDiagnosticsStyle';
    style.textContent=`
      #${DEBUG_ID}{margin:8px 0 2px;padding:8px;border:1px solid #555;background:#111}
      #${DEBUG_ID} button{width:100%;min-height:40px;border:2px solid #f4d33f;background:#000;color:#fff;font:inherit;font-weight:1000}
      #${DEBUG_ID} button:disabled{opacity:.45}
      #${DEBUG_RESULT_ID}{display:block;white-space:pre-wrap;word-break:break-word;margin:7px 0 0;padding:8px;border:1px solid #444;background:#050505;color:#ddd;font:inherit;font-size:11px;line-height:1.55;max-height:180px;overflow:auto}
      .url{cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px}
    `;
    document.head.appendChild(style);
  }

  async function runSingleTest(row,label){
    if(!row)return`${label}: 対象URLなし`;
    let token='';
    try{token=localStorage.getItem('winning-url-manager-token')||''}catch{}
    const headers={'Content-Type':'application/json'};
    if(token)headers['X-Manager-Token']=token;
    const started=performance.now();
    try{
      const response=await fetch(`${API_BASE}/api/coupon-analyze`,{
        method:'POST',headers,
        body:JSON.stringify({items:[{label:'diagnostic',url:row.url}]})
      });
      const text=await response.text();
      let data=null;
      try{data=JSON.parse(text)}catch{}
      const elapsed=Math.max(1,Math.round(performance.now()-started));
      if(response.ok&&data?.results?.[0]){
        const result=data.results[0];
        const product=String(result.product||'商品名不明').slice(0,80);
        const size=result.size==='350'?'350ml':result.size==='500'?'500ml':String(result.capacity||result.size||'').slice(0,40);
        return`${label}: HTTP ${response.status} / ${elapsed}ms\n  status=${result.status||'-'} / ${product}${size?` / ${size}`:''}`;
      }
      const upstream=data?.upstream_status?` / upstream ${data.upstream_status}`:'';
      const message=String(data?.error||text||'応答内容なし').replace(/https?:\/\/\S+/g,'(URL非表示)').slice(0,260);
      return`${label}: HTTP ${response.status}${upstream} / ${elapsed}ms\n  ${message}`;
    }catch(error){
      const elapsed=Math.max(1,Math.round(performance.now()-started));
      return`${label}: 通信例外 / ${elapsed}ms\n  ${String(error?.message||error).slice(0,260)}`;
    }
  }

  async function runDiagnostic(){
    if(debugRunning)return;
    const result=document.getElementById(DEBUG_RESULT_ID);
    const button=document.querySelector(`#${DEBUG_ID} button`);
    const rows=currentRowsSafe();
    const seven=rows.find(row=>supportedKind(row.url)==='seven');
    const famima=rows.find(row=>supportedKind(row.url)==='familymart');
    if(!seven&&!famima){if(result)result.textContent='セブン／ファミマの判定対象URLがありません。';return}
    debugRunning=true;
    if(button){button.disabled=true;button.textContent='1件テスト中…'}
    if(result)result.textContent='セブンとファミマを各1件だけ確認しています…';
    try{
      const lines=[];
      if(seven)lines.push(await runSingleTest(seven,'セブン'));
      if(famima)lines.push(await runSingleTest(famima,'ファミマ'));
      if(result)result.textContent=lines.join('\n\n');
    }finally{
      debugRunning=false;
      if(button){button.disabled=false;button.textContent='1件テスト（原因確認）'}
    }
  }

  function ensureDebug(){
    installStyle();
    const panel=document.getElementById('temporaryCardPanel');
    if(!panel)return;
    if(document.getElementById(DEBUG_ID))return;
    const box=document.createElement('div');
    box.id=DEBUG_ID;
    box.innerHTML=`<button type="button">1件テスト（原因確認）</button><pre id="${DEBUG_RESULT_ID}">セブン・ファミマを各1件だけテストし、HTTPエラーの場所を表示します。</pre>`;
    const analyze=panel.querySelector('#tempAnalyze');
    if(analyze)analyze.insertAdjacentElement('afterend',box);else panel.prepend(box);
    box.querySelector('button').addEventListener('click',runDiagnostic);
  }

  function installUrlTap(){
    const area=document.getElementById('urlArea');
    if(!area||area.dataset.urlTapRestore==='1')return;
    area.dataset.urlTapRestore='1';
    area.addEventListener('pointerdown',event=>{
      const urlEl=event.target.closest('.url');
      if(!urlEl)return;
      urlTapState={urlEl,x:event.clientX,y:event.clientY,started:performance.now(),moved:false};
    },true);
    area.addEventListener('pointermove',event=>{
      if(!urlTapState)return;
      if(Math.hypot(event.clientX-urlTapState.x,event.clientY-urlTapState.y)>10)urlTapState.moved=true;
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

  const observer=new MutationObserver(()=>{
    ensureDebug();
    installUrlTap();
  });
  function start(){
    observer.observe(document.body,{childList:true,subtree:true});
    ensureDebug();
    installUrlTap();
    setInterval(()=>{ensureDebug();installUrlTap()},1200);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
