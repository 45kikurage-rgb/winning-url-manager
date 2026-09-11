(()=>{
  const AIRWALLET_LIST_NAME='エアウォレット';
  let airCurrentItem=null;
  let airCurrentListId=null;

  const isAirWalletList=item=>String(item?.name||'').trim().toLowerCase()===AIRWALLET_LIST_NAME.toLowerCase();

  function ensureAirWalletModal(){
    if(document.getElementById('airWalletModal'))return;
    const modal=document.createElement('div');
    modal.id='airWalletModal';
    modal.className='revenueModal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`
      <div class="revenueModalBox" role="dialog" aria-modal="true" aria-labelledby="airWalletModalTitle">
        <div class="revenueModalHead">
          <div id="airWalletModalTitle" class="revenueModalTitle">エアウォレット対応</div>
        </div>
        <div class="walletSummary">
          <div class="walletRemainingLabel">未対応</div>
          <div id="airWalletRemainingCount" class="walletRemainingCount">--件</div>
          <div id="airWalletItemDate" class="walletItemDate"></div>
        </div>
        <div id="airWalletValue" class="paypayValue" style="user-select:text;-webkit-user-select:text;white-space:pre-wrap;word-break:break-all">文字列を確認しています…</div>
        <button id="airWalletCopyBtn" class="paypayMainAction" type="button" disabled>文字列をコピー</button>
        <div id="airWalletGuide" class="walletGuide">最も古い未対応文字列を1件ずつ表示します。コピーして使用後、「完了・次へ」を押してください。</div>
        <div class="walletModalBtns">
          <button id="airWalletStopBtn" class="secondary">中断する</button>
          <button id="airWalletCompleteBtn" class="walletCompleteBtn" disabled>完了・次へ</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('airWalletStopBtn').onclick=closeAirWalletFlow;
    document.getElementById('airWalletCopyBtn').onclick=copyAirWalletValue;
    document.getElementById('airWalletCompleteBtn').onclick=completeAirWalletItem;
    modal.onclick=e=>{if(e.target===modal)closeAirWalletFlow();};
  }

  function showAirWalletModal(){
    ensureAirWalletModal();
    const modal=document.getElementById('airWalletModal');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }

  function closeAirWalletFlow(){
    const modal=document.getElementById('airWalletModal');
    if(modal){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');}
    airCurrentItem=null;
    airCurrentListId=null;
  }

  async function openAirWalletFlow(item){
    airCurrentListId=item.id;
    airCurrentItem=null;
    ensureAirWalletModal();
    document.getElementById('airWalletRemainingCount').textContent='確認中…';
    document.getElementById('airWalletItemDate').textContent='';
    document.getElementById('airWalletValue').textContent='文字列を確認しています…';
    document.getElementById('airWalletCopyBtn').disabled=true;
    document.getElementById('airWalletCompleteBtn').disabled=true;
    showAirWalletModal();
    await loadAirWalletNext(item.id);
  }

  async function loadAirWalletNext(listId){
    const countEl=document.getElementById('airWalletRemainingCount');
    const dateEl=document.getElementById('airWalletItemDate');
    const valueEl=document.getElementById('airWalletValue');
    const copyBtn=document.getElementById('airWalletCopyBtn');
    const completeBtn=document.getElementById('airWalletCompleteBtn');
    const guide=document.getElementById('airWalletGuide');
    try{
      const res=await call('/api/airwallet-next/'+encodeURIComponent(listId));
      airCurrentListId=listId;
      airCurrentItem=res.item||null;
      countEl.textContent=`${Number(res.remaining_count||0).toLocaleString()}件`;
      completeBtn.disabled=true;
      if(airCurrentItem){
        dateEl.textContent=`登録 ${formatJST(airCurrentItem.created_at)}`;
        valueEl.textContent=String(airCurrentItem.value||'');
        copyBtn.disabled=false;
        copyBtn.textContent='文字列をコピー';
        guide.textContent='表示中の文字列をコピーして使用後、「完了・次へ」を押してください。次の1件が表示されます。';
      }else{
        dateEl.textContent='すべての文字列が対応済みです';
        valueEl.textContent='未対応の文字列はありません';
        copyBtn.disabled=true;
        copyBtn.textContent='未対応なし';
        guide.textContent='このリストの未対応文字列はありません。';
      }
    }catch(error){
      airCurrentItem=null;
      countEl.textContent='確認失敗';
      dateEl.textContent='';
      valueEl.textContent='文字列を取得できませんでした';
      copyBtn.disabled=true;
      completeBtn.disabled=true;
      guide.textContent='未対応文字列の取得に失敗しました。';
      setStatus('エアウォレット未対応文字列の確認に失敗しました: '+error.message,false);
    }
  }

  async function copyAirWalletValue(){
    if(!airCurrentItem)return;
    try{
      await writeClipboard(String(airCurrentItem.value||''));
      document.getElementById('airWalletCompleteBtn').disabled=false;
      setStatus('エアウォレットの文字列をコピーしました ✓');
    }catch(error){
      setStatus('文字列をコピーできませんでした: '+error.message,false);
    }
  }

  async function completeAirWalletItem(){
    if(!airCurrentItem)return;
    const submissionId=airCurrentItem.id;
    const listId=airCurrentListId;
    const button=document.getElementById('airWalletCompleteBtn');
    try{
      button.disabled=true;
      await call('/api/airwallet-complete/'+encodeURIComponent(submissionId),{method:'POST',body:'{}'});
      await loadAll();
      await loadAirWalletNext(listId);
      setStatus('エアウォレット対応済みとして記録し、次の文字列を表示しました ✓');
    }catch(error){
      button.disabled=false;
      setStatus('エアウォレット完了の記録に失敗しました: '+error.message,false);
    }
  }

  function decorateAirWalletCards(){
    if(typeof currentLists==='undefined')return;
    currentLists.filter(isAirWalletList).forEach(item=>{
      document.querySelectorAll(`.listItem[data-list-id="${CSS.escape(String(item.id))}"]`).forEach(card=>{
        const button=card.querySelector('.cardCopyBtn');
        if(!button)return;
        const label=button.querySelector('.cardCopyLabel');
        if(label)label.textContent='未対応';
        button.setAttribute('aria-label',`${item.name}の未対応文字列 ${Number(item.unprocessed_count||0)}件`);
      });
    });
  }

  if(typeof renderLists==='function'){
    const originalRenderLists=renderLists;
    renderLists=function(lists){
      originalRenderLists(lists);
      decorateAirWalletCards();
    };
  }

  const listArea=document.getElementById('listArea');
  if(listArea){
    listArea.addEventListener('click',e=>{
      const button=e.target.closest('.cardCopyBtn');
      if(!button)return;
      const card=button.closest('.listItem');
      if(!card)return;
      const item=currentLists.find(x=>String(x.id)===String(card.dataset.listId));
      if(!isAirWalletList(item))return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openAirWalletFlow(item);
    },true);
  }

  ensureAirWalletModal();
  decorateAirWalletCards();
})();
