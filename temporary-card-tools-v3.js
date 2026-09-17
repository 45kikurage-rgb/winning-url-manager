(() => {
  'use strict';

  const TEMP_LIST_NAME='URL一時保存';
  const CACHE_KEY='winning-url-temp-analysis-v3';
  const selectedIds=new Set();
  let cache=loadCache();
  let cacheRevision=0;
  let running=false;
  let lastSignature='';

  try{
    localStorage.removeItem('winning-url-temp-analysis-v1');
    localStorage.removeItem('winning-url-temp-analysis-v2');
  }catch{}

  function loadCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')||{}}catch{return{}}}
  function saveCache(){try{localStorage.setItem(CACHE_KEY,JSON.stringify(cache))}catch{} cacheRevision+=1}
  function fp(value){let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(16)}
  function isTemp(){return String(currentActive?.name||'').trim()===TEMP_LIST_NAME}
  function rows(){return Array.isArray(currentSubmissionRows)?currentSubmissionRows:[]}
  function rowById(id){return rows().find(row=>String(row.id)===String(id))}
  function resultFor(row){const result=cache[row.id];return result&&result.fp===fp(row.url)?result:null}

  function supported(value){
    try{
      const url=new URL(String(value||'').trim());
      const seven=url.protocol==='https:'&&url.hostname==='coupon.sej.co.jp'&&url.pathname==='/order/cpnsp_03.do'&&url.searchParams.has('hansoku_id');
      const famima=url.protocol==='https:'&&url.hostname==='ncpfa.famima.com'&&url.pathname==='/prd/ebcweb'&&['eKey','cpNo','gyNo'].every(key=>url.searchParams.has(key));
      return seven||famima;
    }catch{return false}
  }

  function resolved(result){
    return result?.status==='used'||(
      result?.status==='ok'&&
      ['350','500','other','none'].includes(String(result.size||''))&&
      result.product&&result.product!=='商品名不明'
    );
  }

  function sizeLabel(result){
    if(!result)return'未判定';
    if(result.status==='used')return'利用済み';
    if(result.status==='unsupported')return'対象外';
    if(result.status==='error')return'判定失敗';
    if(result.size==='350')return'350ml';
    if(result.size==='500')return'500ml';
    if(result.size==='other')return result.capacity||'その他';
    if(result.size==='none')return'容量表記なし';
    return'判定不能';
  }

  function stateLabel(result){
    if(!result)return'未判定';
    if(result.status==='used')return'利用済み';
    if(result.status==='unsupported')return'対象外';
    if(result.status==='error')return'判定失敗';
    return resolved(result)?'判定済み':'要確認';
  }

  function installStyles(){
    if(document.getElementById('tempToolsV3Style'))return;
    const style=document.createElement('style');
    style.id='tempToolsV3Style';
    style.textContent=`
      body.tempToolsActive .serverBar{position:relative!important;top:auto!important;z-index:1!important}
      #temporaryCardPanel{margin:0 0 12px;padding:12px;border:2px solid #f4d33f;background:#080808;color:#fff}
      #temporaryCardPanel *{box-sizing:border-box}.tempHead{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px}.tempTitle{font-size:17px;font-weight:1000}.tempCount{font-size:11px;color:#ddd}
      .tempAnalyze{width:100%;min-height:44px;border:2px solid #fff;background:#fff;color:#000;font-weight:1000}.tempAnalyze:disabled{opacity:.45}.tempBar{height:7px;margin:8px 0 3px;border:1px solid #666;background:#181818;overflow:hidden}.tempBar>i{display:block;height:100%;width:0;background:#fff;transition:width .15s}.tempProgress{min-height:17px;text-align:right;font-size:11px;color:#ccc}
      .tempFilters{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.tempFilters select,.tempTarget{width:100%;min-width:0;padding:9px 7px;border:1px solid #666;background:#111;color:#fff;font:inherit;font-size:12px}
      .tempSelectLine{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:8px;padding:8px;border:1px solid #555}.tempSelectAll,.tempRowCheck{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:1000}.tempSelectAll input,.tempRowCheck input{width:19px;height:19px;margin:0;accent-color:#f4d33f}.tempSelected{font-size:12px;font-weight:1000}
      .tempButtons{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.tempButtons button,.tempMove button{min-height:42px;border:2px solid #fff;background:#000;color:#fff}.tempButtons button:disabled,.tempMove button:disabled{opacity:.4}.tempMove{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;margin-top:7px}.tempMove button{min-width:110px}
      .tempRowCheck{margin:0 0 5px;color:#fff}.tempMeta{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}.tempTag{display:inline-flex;padding:3px 7px;border:1px solid #9ca3af;border-radius:6px;background:#f9fafb;color:#111;font-size:10px;font-weight:900}.tempTag.ok{border-color:#22c55e;background:#dcfce7}.tempTag.warn{border-color:#f59e0b;background:#fef3c7}.tempTag.err{border-color:#ef4444;background:#fee2e2}.urlItem.tempChosen{outline:2px solid #f4d33f;outline-offset:-2px;background:#181818}.urlItem.tempHidden{display:none!important}
      @media(max-width:360px){.tempFilters,.tempMove{grid-template-columns:1fr}.tempMove button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel(){
    const area=document.getElementById('urlArea');
    if(!area)return null;
    let panel=document.getElementById('temporaryCardPanel');
    if(!isTemp()){
      panel?.remove();
      document.body.classList.remove('tempToolsActive');
      return null;
    }
    document.body.classList.add('tempToolsActive');
    if(panel)return panel;
    panel=document.createElement('section');
    panel.id='temporaryCardPanel';
    panel.innerHTML=`
      <div class="tempHead"><span class="tempTitle">URL振り分け</span><span class="tempCount" id="tempCount">0件</span></div>
      <button type="button" id="tempAnalyze" class="tempAnalyze">中身自動判定</button>
      <div class="tempBar"><i id="tempBar"></i></div><div class="tempProgress" id="tempProgress"></div>
      <div class="tempFilters"><select id="tempProduct"><option value="">商品：すべて</option></select><select id="tempSize"><option value="">容量：すべて</option></select></div>
      <div class="tempSelectLine"><label class="tempSelectAll"><input type="checkbox" id="tempAll">表示中をすべて選択</label><span id="tempSelected" class="tempSelected">0件選択</span></div>
      <div class="tempButtons"><button type="button" id="tempCopy">選択URLを一括コピー</button><button type="button" id="tempClear">選択解除</button></div>
      <div class="tempMove"><select id="tempTarget" class="tempTarget"><option value="">移動先カードを選択</option></select><button type="button" id="tempMove">カードへ移動</button></div>`;
    area.parentElement?.insertBefore(panel,area);
    panel.querySelector('#tempAnalyze').onclick=runAnalysis;
    panel.querySelector('#tempProduct').onchange=applyFilter;
    panel.querySelector('#tempSize').onchange=applyFilter;
    panel.querySelector('#tempAll').onchange=event=>{
      for(const element of visibleEls()){
        const id=element.dataset.submissionId;
        if(event.target.checked)selectedIds.add(id);else selectedIds.delete(id);
      }
      decorate();updateControls();
    };
    panel.querySelector('#tempCopy').onclick=copySelected;
    panel.querySelector('#tempClear').onclick=()=>{selectedIds.clear();decorate();updateControls()};
    panel.querySelector('#tempMove').onclick=moveSelected;
    return panel;
  }

  function fillTargets(){
    const select=document.getElementById('tempTarget');if(!select)return;
    const old=select.value;
    const options=(Array.isArray(currentLists)?currentLists:[])
      .filter(item=>item?.id&&item.id!==currentActive?.id)
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ja'));
    select.innerHTML='<option value="">移動先カードを選択</option>';
    for(const item of options){const option=document.createElement('option');option.value=item.id;option.textContent=item.name||item.id;select.appendChild(option)}
    if(options.some(item=>item.id===old))select.value=old;
  }

  function fillFilters(){
    const product=document.getElementById('tempProduct'),size=document.getElementById('tempSize');
    if(!product||!size)return;
    const oldProduct=product.value,oldSize=size.value,products=new Set(),sizes=new Set();
    for(const row of rows()){
      const result=resultFor(row);
      if(resolved(result)){
        products.add(result.status==='used'?'利用済み':result.product);
        sizes.add(sizeLabel(result));
      }
    }
    product.innerHTML='<option value="">商品：すべて</option>';
    [...products].sort((a,b)=>a.localeCompare(b,'ja')).forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;product.appendChild(option)});
    size.innerHTML='<option value="">容量：すべて</option>';
    [...sizes].sort((a,b)=>a.localeCompare(b,'ja')).forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;size.appendChild(option)});
    if([...product.options].some(option=>option.value===oldProduct))product.value=oldProduct;
    if([...size.options].some(option=>option.value===oldSize))size.value=oldSize;
  }

  function decorate(){
    if(!isTemp())return;
    for(const element of document.querySelectorAll('#urlArea .urlItem[data-submission-id]')){
      const id=element.dataset.submissionId,row=rowById(id);if(!row)continue;
      const main=element.querySelector('.urlMain')||element.lastElementChild||element;
      let check=main.querySelector('.tempRowCheck');
      if(!check){
        check=document.createElement('label');check.className='tempRowCheck';check.innerHTML='<input type="checkbox"><span>選択</span>';main.insertBefore(check,main.firstChild);
        check.querySelector('input').onchange=event=>{if(event.target.checked)selectedIds.add(id);else selectedIds.delete(id);element.classList.toggle('tempChosen',event.target.checked);updateControls()};
      }
      check.querySelector('input').checked=selectedIds.has(id);
      element.classList.toggle('tempChosen',selectedIds.has(id));
      let meta=main.querySelector('.tempMeta');
      if(!meta){meta=document.createElement('div');meta.className='tempMeta';check.insertAdjacentElement('afterend',meta)}
      const result=resultFor(row),key=`${result?.product||''}|${result?.size||''}|${result?.capacity||''}|${result?.status||''}`;
      if(meta.dataset.key===key)continue;
      meta.dataset.key=key;meta.innerHTML='';
      const values=resolved(result)?[result.status==='used'?'利用済み':result.product,sizeLabel(result),stateLabel(result)]:[stateLabel(result)];
      for(const value of values){const tag=document.createElement('span');tag.className='tempTag '+(resolved(result)?'ok':result?.status==='error'?'err':result?'warn':'');tag.textContent=value;meta.appendChild(tag)}
    }
  }

  function matches(row){
    const productFilter=document.getElementById('tempProduct')?.value||'',sizeFilter=document.getElementById('tempSize')?.value||'',result=resultFor(row);
    const product=result?.status==='used'?'利用済み':resolved(result)?result.product:'';
    const size=resolved(result)?sizeLabel(result):'';
    return(!productFilter||productFilter===product)&&(!sizeFilter||sizeFilter===size);
  }

  function visibleEls(){return[...document.querySelectorAll('#urlArea .urlItem[data-submission-id]')].filter(element=>!element.classList.contains('tempHidden')&&getComputedStyle(element).display!=='none')}

  function applyFilter(){
    if(!isTemp())return;
    for(const element of document.querySelectorAll('#urlArea .urlItem[data-submission-id]')){
      const row=rowById(element.dataset.submissionId);element.classList.toggle('tempHidden',Boolean(row&&!matches(row)));
    }
    const visible=visibleEls().map(element=>element.dataset.submissionId),checked=visible.filter(id=>selectedIds.has(id)).length,all=document.getElementById('tempAll');
    if(all){all.checked=visible.length>0&&checked===visible.length;all.indeterminate=checked>0&&checked<visible.length}
    updateControls();
  }

  function updateControls(){
    if(!isTemp())return;
    const all=rows(),supportedCount=all.filter(row=>supported(row.url)).length,resolvedCount=all.filter(row=>resolved(resultFor(row))).length,failedCount=all.filter(row=>resultFor(row)?.status==='error').length;
    const count=document.getElementById('tempCount');if(count)count.textContent=`${all.length}件／判定済 ${resolvedCount}／対象 ${supportedCount}${failedCount?`／失敗 ${failedCount}`:''}`;
    const selected=document.getElementById('tempSelected');if(selected)selected.textContent=`${selectedIds.size}件選択`;
    for(const id of ['tempCopy','tempClear','tempMove']){const button=document.getElementById(id);if(button)button.disabled=running||selectedIds.size===0}
    const analyze=document.getElementById('tempAnalyze');if(analyze)analyze.disabled=running||supportedCount===0;
  }

  async function analyzeOne(item){
    const data=await call('/api/coupon-analyze',{method:'POST',body:JSON.stringify({items:[{label:item.id,url:item.url}]})});
    if(!data?.results?.[0])throw new Error(data?.error||'確認に失敗しました');
    return data.results[0];
  }

  async function analyzePass(items,label){
    const output=new Array(items.length);let cursor=0,done=0;
    async function worker(){
      while(cursor<items.length){
        const index=cursor++,item=items[index];
        try{output[index]=await analyzeOne(item)}catch(error){output[index]={label:item.id,url:item.url,product:'商品名不明',size:'unknown',status:'error',message:error?.message||'確認に失敗しました'}}
        done+=1;
        const percent=items.length?Math.round(done/items.length*100):0;
        const bar=document.getElementById('tempBar'),progress=document.getElementById('tempProgress');
        if(bar)bar.style.width=`${percent}%`;if(progress)progress.textContent=`${label} ${done}/${items.length}件`;
      }
    }
    await Promise.all(Array.from({length:Math.min(4,items.length)},worker));
    return output;
  }

  async function runAnalysis(){
    if(running||!isTemp())return;
    const all=rows(),supportedRows=all.filter(row=>supported(row.url));
    if(!supportedRows.length){setStatus('判定対応URLがありません',false);return}
    let targets=supportedRows.filter(row=>{const result=resultFor(row);return!result||!resolved(result)||result.status==='error'});
    if(!targets.length)targets=supportedRows;
    running=true;updateControls();
    const button=document.getElementById('tempAnalyze');if(button)button.textContent='判定中…';
    try{
      let pending=targets.map(row=>({id:row.id,url:row.url}));const final=new Map();
      for(let pass=0;pass<=2&&pending.length;pass+=1){
        const results=await analyzePass(pending,pass===0?'初回判定':`再判定 ${pass}/2`);
        results.forEach(result=>final.set(result.url,result));
        pending=results.filter(result=>!resolved(result)&&result.status!=='used').map(result=>({id:result.label,url:result.url}));
      }
      for(const row of targets){
        const result=final.get(row.url);
        cache[row.id]={fp:fp(row.url),product:result?.product||'商品名不明',size:result?.size||'unknown',capacity:result?.capacity||'',status:result?.status||'error',message:result?.message||'',checkedAt:Date.now()};
      }
      for(const row of all.filter(row=>!supported(row.url)))cache[row.id]={fp:fp(row.url),product:'対象外',size:'none',capacity:'',status:'unsupported',message:'セブン・ファミマ以外',checkedAt:Date.now()};
      saveCache();lastSignature='';sync(true);
      const unresolved=targets.filter(row=>!resolved(resultFor(row))).length;
      const progress=document.getElementById('tempProgress'),bar=document.getElementById('tempBar');if(bar)bar.style.width='100%';if(progress)progress.textContent=unresolved?`完了／要確認 ${unresolved}件`:'判定完了';
      setStatus(unresolved?`中身判定完了：要確認 ${unresolved}件`:'中身判定が完了しました ✓',unresolved===0);
    }catch(error){
      setStatus(`中身判定に失敗しました: ${error?.message||error}`,false);
    }finally{
      running=false;if(button)button.textContent='中身自動判定';updateControls();
    }
  }

  async function copySelected(){
    const chosen=rows().filter(row=>selectedIds.has(String(row.id))||selectedIds.has(row.id));if(!chosen.length)return;
    const text=chosen.map(row=>row.url).join('\n');
    try{await navigator.clipboard.writeText(text)}catch{const textarea=document.createElement('textarea');textarea.value=text;textarea.style.position='fixed';textarea.style.opacity='0';document.body.appendChild(textarea);textarea.select();document.execCommand('copy');textarea.remove()}
    setStatus(`${chosen.length}件のURLをコピーしました ✓`);
  }

  async function moveSelected(){
    if(running||!isTemp()||!selectedIds.size)return;
    const targetId=document.getElementById('tempTarget')?.value||'',target=(Array.isArray(currentLists)?currentLists:[]).find(item=>item.id===targetId);
    if(!target){setStatus('移動先カードを選択してください',false);return}
    const chosen=rows().filter(row=>selectedIds.has(String(row.id))||selectedIds.has(row.id));if(!chosen.length)return;
    const ok=typeof showSiteConfirm==='function'?await showSiteConfirm(`${chosen.length}件を「${target.name||''}」へ移動しますか？\n\n移動後は移動先カードの単価で収益が再計算されます。`):confirm(`${chosen.length}件を「${target.name||''}」へ移動しますか？`);
    if(!ok)return;
    running=true;updateControls();
    const move=document.getElementById('tempMove');if(move)move.textContent='移動中…';
    let cursor=0,done=0,success=0;const failed=[];
    async function worker(){
      while(cursor<chosen.length){
        const row=chosen[cursor++];
        try{
          await call('/api/submission/'+encodeURIComponent(row.id),{method:'POST',body:JSON.stringify({url:row.url,list_id:targetId})});
          success+=1;selectedIds.delete(String(row.id));delete cache[row.id];
        }catch(error){failed.push({row,error})}
        done+=1;const percent=Math.round(done/chosen.length*100),bar=document.getElementById('tempBar'),progress=document.getElementById('tempProgress');if(bar)bar.style.width=`${percent}%`;if(progress)progress.textContent=`移動中 ${done}/${chosen.length}件`;
      }
    }
    try{
      await Promise.all(Array.from({length:Math.min(4,chosen.length)},worker));saveCache();
      if(success){try{await call('/api/revenue/update',{method:'POST',body:'{}'})}catch{}}
      await loadAll();
      if(failed.length)setStatus(`${success}件移動／${failed.length}件失敗`,false);else setStatus(`${success}件を「${target.name||''}」へ移動しました ✓`);
    }finally{
      running=false;if(move)move.textContent='カードへ移動';const bar=document.getElementById('tempBar'),progress=document.getElementById('tempProgress');if(bar)bar.style.width='0%';if(progress&&!failed.length)progress.textContent='';lastSignature='';sync(true);
    }
  }

  function sync(force=false){
    installStyles();
    if(!isTemp()){
      document.getElementById('temporaryCardPanel')?.remove();
      document.body.classList.remove('tempToolsActive');
      selectedIds.clear();lastSignature='';return;
    }
    ensurePanel();
    const signature=[currentActive?.id||'',rows().map(row=>`${row.id}:${fp(row.url)}`).join(','),cacheRevision,document.querySelectorAll('#urlArea .urlItem[data-submission-id]').length].join('|');
    if(!force&&signature===lastSignature)return;
    lastSignature=signature;
    for(const id of [...selectedIds])if(!rowById(id))selectedIds.delete(id);
    fillTargets();fillFilters();decorate();applyFilter();updateControls();
  }

  const observer=new MutationObserver(()=>queueMicrotask(()=>sync(false)));
  function start(){observer.observe(document.body,{childList:true,subtree:true});document.addEventListener('click',()=>setTimeout(()=>sync(false),0),true);setInterval(()=>sync(false),1000);sync(true)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
