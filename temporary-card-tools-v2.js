(() => {
  'use strict';

  const TEMP_LIST_NAME='URL一時保存';
  const ANALYZER_API='https://seven-coupon-size-counter.regal-elk-8007.chatgpt.site/api/analyze';
  const CACHE_KEY='winning-url-temp-analysis-v2';
  const selectedIds=new Set();
  let cache=loadCache();
  let cacheRevision=0;
  let running=false;
  let lastSignature='';

  function loadCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')||{}}catch{return{}}}
  function saveCache(){try{localStorage.setItem(CACHE_KEY,JSON.stringify(cache))}catch{} cacheRevision+=1}
  function fp(value){let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(16)}
  function isTemp(){return String(currentActive?.name||'').trim()===TEMP_LIST_NAME}
  function rows(){return Array.isArray(currentSubmissionRows)?currentSubmissionRows:[]}
  function rowById(id){return rows().find(r=>String(r.id)===String(id))}
  function resultFor(row){const r=cache[row.id];return r&&r.fp===fp(row.url)?r:null}
  function supported(value){
    try{
      const u=new URL(String(value||'').trim());
      const seven=u.protocol==='https:'&&u.hostname==='coupon.sej.co.jp'&&u.pathname==='/order/cpnsp_03.do'&&u.searchParams.has('hansoku_id');
      const famima=u.protocol==='https:'&&u.hostname==='ncpfa.famima.com'&&u.pathname==='/prd/ebcweb'&&['eKey','cpNo','gyNo'].every(k=>u.searchParams.has(k));
      return seven||famima;
    }catch{return false}
  }
  function resolved(r){return r?.status==='used'||(r?.status==='ok'&&['350','500','other','none'].includes(String(r.size||''))&&r.product&&r.product!=='商品名不明')}
  function sizeLabel(r){
    if(!r)return'未判定'; if(r.status==='used')return'利用済み'; if(r.status==='unsupported')return'対象外'; if(r.status==='error')return'判定失敗';
    if(r.size==='350')return'350ml'; if(r.size==='500')return'500ml'; if(r.size==='other')return r.capacity||'その他'; if(r.size==='none')return'容量表記なし'; return'判定不能';
  }
  function stateLabel(r){if(!r)return'未判定';if(r.status==='used')return'利用済み';if(r.status==='unsupported')return'対象外';if(r.status==='error')return'判定失敗';return resolved(r)?'判定済み':'要確認'}

  function styles(){
    if(document.getElementById('tempToolsV2Style'))return;
    const s=document.createElement('style');s.id='tempToolsV2Style';s.textContent=`
      #temporaryCardPanel{margin:0 0 12px;padding:12px;border:2px solid #f4d33f;background:#080808;color:#fff}
      #temporaryCardPanel *{box-sizing:border-box}.tempHead{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px}.tempTitle{font-size:17px;font-weight:1000}.tempCount{font-size:11px;color:#ddd}
      .tempAnalyze{width:100%;min-height:44px;border:2px solid #fff;background:#fff;color:#000;font-weight:1000}.tempAnalyze:disabled{opacity:.45}.tempBar{height:7px;margin:8px 0 3px;border:1px solid #666;background:#181818;overflow:hidden}.tempBar>i{display:block;height:100%;width:0;background:#fff}.tempProgress{min-height:17px;text-align:right;font-size:11px;color:#ccc}
      .tempFilters{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.tempFilters select,.tempTarget{width:100%;min-width:0;padding:9px 7px;border:1px solid #666;background:#111;color:#fff;font:inherit;font-size:12px}
      .tempSelectLine{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:8px;padding:8px;border:1px solid #555}.tempSelectAll,.tempRowCheck{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:1000}.tempSelectAll input,.tempRowCheck input{width:19px;height:19px;margin:0;accent-color:#f4d33f}.tempSelected{font-size:12px;font-weight:1000}
      .tempButtons{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.tempButtons button,.tempMove button{min-height:42px;border:2px solid #fff;background:#000;color:#fff}.tempButtons button:disabled,.tempMove button:disabled{opacity:.4}.tempMove{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;margin-top:7px}.tempMove button{min-width:110px}
      .tempRowCheck{margin:0 0 5px;color:#111}.tempMeta{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}.tempTag{display:inline-flex;padding:3px 7px;border:1px solid #9ca3af;border-radius:6px;background:#f9fafb;color:#111;font-size:10px;font-weight:900}.tempTag.ok{border-color:#22c55e;background:#dcfce7}.tempTag.warn{border-color:#f59e0b;background:#fef3c7}.tempTag.err{border-color:#ef4444;background:#fee2e2}.urlItem.tempChosen{outline:2px solid #f4d33f;outline-offset:-2px;background:#fffbea}.urlItem.tempHidden{display:none!important}
      @media(max-width:360px){.tempFilters,.tempMove{grid-template-columns:1fr}.tempMove button{width:100%}}
    `;document.head.appendChild(s);
  }

  function ensurePanel(){
    const area=document.getElementById('urlArea'); if(!area)return null;
    let p=document.getElementById('temporaryCardPanel');
    if(!isTemp()){p?.remove();return null}
    if(p)return p;
    p=document.createElement('section');p.id='temporaryCardPanel';p.innerHTML=`
      <div class="tempHead"><span class="tempTitle">URL振り分け</span><span class="tempCount" id="tempCount">0件</span></div>
      <button type="button" id="tempAnalyze" class="tempAnalyze">中身自動判定</button>
      <div class="tempBar"><i id="tempBar"></i></div><div class="tempProgress" id="tempProgress"></div>
      <div class="tempFilters"><select id="tempProduct"><option value="">商品：すべて</option></select><select id="tempSize"><option value="">容量：すべて</option></select></div>
      <div class="tempSelectLine"><label class="tempSelectAll"><input type="checkbox" id="tempAll">表示中をすべて選択</label><span id="tempSelected" class="tempSelected">0件選択</span></div>
      <div class="tempButtons"><button type="button" id="tempCopy">選択URLを一括コピー</button><button type="button" id="tempClear">選択解除</button></div>
      <div class="tempMove"><select id="tempTarget" class="tempTarget"><option value="">移動先カードを選択</option></select><button type="button" id="tempMove">カードへ移動</button></div>`;
    area.parentElement?.insertBefore(p,area);
    p.querySelector('#tempAnalyze').onclick=runAnalysis;
    p.querySelector('#tempProduct').onchange=applyFilter;
    p.querySelector('#tempSize').onchange=applyFilter;
    p.querySelector('#tempAll').onchange=e=>{for(const el of visibleEls()){const id=el.dataset.submissionId;if(e.target.checked)selectedIds.add(id);else selectedIds.delete(id)}decorate();updateControls()};
    p.querySelector('#tempCopy').onclick=copySelected;
    p.querySelector('#tempClear').onclick=()=>{selectedIds.clear();decorate();updateControls()};
    p.querySelector('#tempMove').onclick=moveSelected;
    return p;
  }

  function fillTargets(){
    const s=document.getElementById('tempTarget');if(!s)return;const old=s.value;
    const options=(Array.isArray(currentLists)?currentLists:[]).filter(x=>x?.id&&x.id!==currentActive?.id).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ja'));
    s.innerHTML='<option value="">移動先カードを選択</option>';
    for(const item of options){const o=document.createElement('option');o.value=item.id;o.textContent=item.name||item.id;s.appendChild(o)}
    if(options.some(x=>x.id===old))s.value=old;
  }

  function fillFilters(){
    const ps=document.getElementById('tempProduct'),ss=document.getElementById('tempSize');if(!ps||!ss)return;const po=ps.value,so=ss.value,p=new Set(),sz=new Set();
    for(const row of rows()){const r=resultFor(row);if(resolved(r)){p.add(r.status==='used'?'利用済み':r.product);sz.add(sizeLabel(r))}}
    ps.innerHTML='<option value="">商品：すべて</option>';[...p].sort((a,b)=>a.localeCompare(b,'ja')).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;ps.appendChild(o)});
    ss.innerHTML='<option value="">容量：すべて</option>';[...sz].sort((a,b)=>a.localeCompare(b,'ja')).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;ss.appendChild(o)});
    if([...ps.options].some(o=>o.value===po))ps.value=po;if([...ss.options].some(o=>o.value===so))ss.value=so;
  }

  function decorate(){
    if(!isTemp())return;
    for(const el of document.querySelectorAll('#urlArea .urlItem[data-submission-id]')){
      const id=el.dataset.submissionId,row=rowById(id);if(!row)continue;const main=el.querySelector('.urlMain')||el.lastElementChild||el;
      let check=main.querySelector('.tempRowCheck');if(!check){check=document.createElement('label');check.className='tempRowCheck';check.innerHTML='<input type="checkbox"><span>選択</span>';main.insertBefore(check,main.firstChild);check.querySelector('input').onchange=e=>{if(e.target.checked)selectedIds.add(id);else selectedIds.delete(id);el.classList.toggle('tempChosen',e.target.checked);updateControls()}}
      check.querySelector('input').checked=selectedIds.has(id);el.classList.toggle('tempChosen',selectedIds.has(id));
      let meta=main.querySelector('.tempMeta');if(!meta){meta=document.createElement('div');meta.className='tempMeta';check.insertAdjacentElement('afterend',meta)}
      const r=resultFor(row),key=`${r?.product||''}|${r?.size||''}|${r?.capacity||''}|${r?.status||''}`;if(meta.dataset.key===key)continue;meta.dataset.key=key;meta.innerHTML='';
      const vals=resolved(r)?[r.status==='used'?'利用済み':r.product,sizeLabel(r),stateLabel(r)]:[stateLabel(r)];for(const v of vals){const t=document.createElement('span');t.className='tempTag '+(resolved(r)?'ok':r?.status==='error'?'err':r?'warn':'');t.textContent=v;meta.appendChild(t)}
    }
  }

  function matches(row){const p=document.getElementById('tempProduct')?.value||'',s=document.getElementById('tempSize')?.value||'',r=resultFor(row);const rp=r?.status==='used'?'利用済み':resolved(r)?r.product:'',rs=resolved(r)?sizeLabel(r):'';return(!p||p===rp)&&(!s||s===rs)}
  function visibleEls(){return[...document.querySelectorAll('#urlArea .urlItem[data-submission-id]')].filter(el=>!el.classList.contains('tempHidden')&&getComputedStyle(el).display!=='none')}
  function applyFilter(){
    if(!isTemp())return;for(const el of document.querySelectorAll('#urlArea .urlItem[data-submission-id]')){const row=rowById(el.dataset.submissionId);el.classList.toggle('tempHidden',Boolean(row&&!matches(row)))}
    const vis=visibleEls().map(el=>el.dataset.submissionId),checked=vis.filter(id=>selectedIds.has(id)).length,all=document.getElementById('tempAll');if(all){all.checked=vis.length>0&&checked===vis.length;all.indeterminate=checked>0&&checked<vis.length}updateControls();
  }

  function updateControls(){
    if(!isTemp())return;const all=rows(),supportedN=all.filter(r=>supported(r.url)).length,resolvedN=all.filter(r=>resolved(resultFor(r))).length,failed=all.filter(r=>resultFor(r)?.status==='error').length;
    const c=document.getElementById('tempCount');if(c)c.textContent=`${all.length}件／判定済 ${resolvedN}／対象 ${supportedN}${failed?`／失敗 ${failed}`:''}`;const sc=document.getElementById('tempSelected');if(sc)sc.textContent=`${selectedIds.size}件選択`;
    for(const id of ['tempCopy','tempClear','tempMove']){const b=document.getElementById(id);if(b)b.disabled=running||selectedIds.size===0}const a=document.getElementById('tempAnalyze');if(a)a.disabled=running||supportedN===0;
  }

  async function analyzeOne(item){const res=await fetch(ANALYZER_API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{label:item.id,url:item.url}]})});const data=await res.json().catch(()=>({}));if(!res.ok||!data.results?.[0])throw new Error(data.error||'確認に失敗しました');return data.results[0]}
  async function pass(items,label){const out=new Array(items.length);let cursor=0,done=0;async function worker(){while(cursor<items.length){const i=cursor++,item=items[i];try{out[i]=await analyzeOne(item)}catch(e){out[i]={label:item.id,url:item.url,product:'商品名不明',size:'unknown',status:'error',message:e?.message||'確認に失敗しました'}}done+=1;const pct=items.length?Math.round(done/items.length*100):0;document.getElementById('tempBar').style.width=`${pct}%`;document.getElementById('tempProgress').textContent=`${label} ${done}/${items.length}件`}}await Promise.all(Array.from({length:Math.min(4,items.length)},worker));return out}

  async function runAnalysis(){
    if(running||!isTemp())return;const all=rows(),supportedRows=all.filter(r=>supported(r.url));if(!supportedRows.length){setStatus('判定対応URLがありません',false);return}
    let targets=supportedRows.filter(row=>{const r=resultFor(row);return!r||!resolved(r)||r.status==='error'});if(!targets.length)targets=supportedRows;running=true;updateControls();const btn=document.getElementById('tempAnalyze');btn.textContent='判定中…';
    try{
      let pending=targets.map(r=>({id:r.id,url:r.url}));const final=new Map();for(let n=0;n<=2&&pending.length;n+=1){const rs=await pass(pending,n===0?'初回判定':`再判定 ${n}/2`);rs.forEach(r=>final.set(r.url,r));pending=rs.filter(r=>!resolved(r)&&r.status!=='used').map(r=>({id:r.label,url:r.url}))}
      for(const row of targets){const r=final.get(row.url);cache[row.id]={fp:fp(row.url),product:r?.product||'商品名不明',size:r?.size||'unknown',capacity:r?.capacity||'',status:r?.status||'error',message:r?.message||'',checkedAt:Date.now()}}
      for(const row of all.filter(r=>!supported(r.url)))cache[row.id]={fp:fp(row.url),product:'対象外',size:'none',capacity:'',status:'unsupported',message:'セブン・ファミマ以外',checkedAt:Date.now()};saveCache();lastSignature='';sync(true);const unresolved=targets.filter(row=>!resolved(resultFor(row))).length;document.getElementById('tempBar').style.width='100%';document.getElementById('tempProgress').textContent=unresolved?`完了／要確認 ${unresolved}件`:'判定完了';setStatus(unresolved?`中身判定完了：要確認 ${unresolved}件`:'中身判定が完了しました ✓',unresolved===0);
    }finally{running=false;btn.textContent='中身自動判定';updateControls()}
  }

  async function copySelected(){const chosen=rows().filter(r=>selectedIds.has(String(r.id)));if(!chosen.length)return;const text=chosen.map(r=>r.url).join('\n');try{await navigator.clipboard.writeText(text)}catch{const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();document.execCommand('copy');t.remove()}setStatus(`${chosen.length}件のURLをコピーしました ✓`)}

  async function moveSelected(){
    if(running||!selectedIds.size||!isTemp())return;const targetId=document.getElementById('tempTarget')?.value||'',target=(Array.isArray(currentLists)?currentLists:[]).find(x=>x.id===targetId);if(!target){setStatus('移動先カードを選択してください',false);return}const chosen=rows().filter(r=>selectedIds.has(String(r.id)));if(!chosen.length)return;
    const ok=typeof showSiteConfirm==='function'?await showSiteConfirm(`${chosen.length}件を「${target.name||''}」へ移動しますか？\n\n移動後は移動先カードの単価で収益が再計算されます。`):confirm(`${chosen.length}件を「${target.name||''}」へ移動しますか？`);if(!ok)return;
    running=true;updateControls();const btn=document.getElementById('tempMove');btn.textContent='移動中…';let cursor=0,done=0,success=0,fail=0;async function worker(){while(cursor<chosen.length){const row=chosen[cursor++];try{await call('/api/submission/'+encodeURIComponent(row.id),{method:'POST',body:JSON.stringify({url:row.url,list_id:targetId})});success+=1;selectedIds.delete(String(row.id));delete cache[row.id]}catch{fail+=1}done+=1;document.getElementById('tempBar').style.width=`${Math.round(done/chosen.length*100)}%`;document.getElementById('tempProgress').textContent=`移動中 ${done}/${chosen.length}件`}}
    try{await Promise.all(Array.from({length:Math.min(4,chosen.length)},worker));saveCache();if(success)try{await call('/api/revenue/update',{method:'POST',body:'{}'})}catch{}await loadAll();setStatus(fail?`${success}件移動／${fail}件失敗`:`${success}件を「${target.name||''}」へ移動しました ✓`,fail===0)}finally{running=false;btn.textContent='カードへ移動';lastSignature='';setTimeout(()=>sync(true),100)}
  }

  function signature(){return`${currentActive?.id||''}|${cacheRevision}|${[...document.querySelectorAll('#urlArea .urlItem[data-submission-id]')].map(e=>e.dataset.submissionId).join(',')}`}
  function sync(force=false){styles();if(!isTemp()){document.getElementById('temporaryCardPanel')?.remove();selectedIds.clear();lastSignature='';return}ensurePanel();const sig=signature();if(!force&&sig===lastSignature){updateControls();return}lastSignature=sig;fillTargets();fillFilters();decorate();applyFilter();updateControls()}
  function start(){styles();document.addEventListener('click',()=>setTimeout(()=>sync(),80),true);setInterval(()=>sync(),900);sync(true)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
