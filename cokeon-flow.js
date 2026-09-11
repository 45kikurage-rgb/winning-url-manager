(()=>{
  const COKEON_LIST_NAME='コークオン10p';
  let cokeCurrentItem=null;
  let cokeCurrentListId=null;

  const isCokeOnList=item=>String(item?.name||'').trim().toLowerCase()===COKEON_LIST_NAME.toLowerCase();

  function ensureCokeModal(){
    if(document.getElementById('cokeOnModal'))return;
    const modal=document.createElement('div');
    modal.id='cokeOnModal';
    modal.className='revenueModal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`
      <div class="revenueModalBox" role="dialog" aria-modal="true" aria-labelledby="cokeOnModalTitle">
        <div class="revenueModalHead">
          <div id="cokeOnModalTitle" class="revenueModalTitle">コークオン10p対応</div>
        </div>
        <div class="walletSummary">
          <div class="walletRemainingLabel">未対応</div>
          <div id="cokeOnRemainingCount" class="walletRemainingCount">--件</div>
          <div id="cokeOnItemDate" class="walletItemDate"></div>
        </div>
        <a id="cokeOnOpenUrlBtn" class="walletOpenBtn is-disabled" href="#" target="_blank" rel="noopener noreferrer">URLを開く</a>
        <div id="cokeOnGuide" class="walletGuide">最も古い未対応コードをURLに変換して1件ずつ開きます。利用後に「対応完了・次へ」を押してください。</div>
        <div class="walletModalBtns">
          <button id="cokeOnStopBtn" class="secondary">中断する</button>
          <button id="cokeOnCompleteBtn" class="walletCompleteBtn" disabled>対応完了・次へ</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('cokeOnStopBtn').onclick=closeCokeOnFlow;
    document.getElementById('cokeOnOpenUrlBtn').onclick=e=>{
      if(!cokeCurrentItem){e.preventDefault();return;}
      document.getElementById('cokeOnCompleteBtn').disabled=false;
      setStatus('コークオンURLを開きました。利用後に「対応完了・次へ」を押してください');
    };
    document.getElementById('cokeOnCompleteBtn').onclick=completeCokeOnItem;
    modal.onclick=e=>{if(e.target===modal)closeCokeOnFlow();};
  }

  function showCokeOnModal(){
    ensureCokeModal();
    const modal=document.getElementById('cokeOnModal');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }

  function closeCokeOnFlow(){
    const modal=document.getElementById('cokeOnModal');
    if(modal){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');}
    cokeCurrentItem=null;
    cokeCurrentListId=null;
  }

  async function openCokeOnFlow(item){
    cokeCurrentListId=item.id;
    cokeCurrentItem=null;
    ensureCokeModal();
    document.getElementById('cokeOnRemainingCount').textContent='確認中…';
    document.getElementById('cokeOnItemDate').textContent='';
    const openBtn=document.getElementById('cokeOnOpenUrlBtn');
    openBtn.classList.add('is-disabled');
    openBtn.removeAttribute('href');
    openBtn.textContent='URLを確認中…';
    document.getElementById('cokeOnCompleteBtn').disabled=true;
    showCokeOnModal();
    await loadCokeOnNext(item.id);
  }

  async function loadCokeOnNext(listId){
    const countEl=document.getElementById('cokeOnRemainingCount');
    const dateEl=document.getElementById('cokeOnItemDate');
    const openBtn=document.getElementById('cokeOnOpenUrlBtn');
    const guide=document.getElementById('cokeOnGuide');
    const completeBtn=document.getElementById('cokeOnCompleteBtn');
    try{
      const res=await call('/api/cokeon-next/'+encodeURIComponent(listId));
      cokeCurrentListId=listId;
      cokeCurrentItem=res.item||null;
      countEl.textContent=`${Number(res.remaining_count||0).toLocaleString()}件`;
      completeBtn.disabled=true;
      if(cokeCurrentItem){
        dateEl.textContent=`登録 ${formatJST(cokeCurrentItem.created_at)}`;
        openBtn.href=cokeCurrentItem.export_value||exportValue(cokeCurrentItem.url);
        openBtn.classList.remove('is-disabled');
        openBtn.textContent='コークオンURLを開く';
        guide.textContent='最も古い未対応コードをURLに変換して1件ずつ開きます。利用後に「対応完了・次へ」を押してください。';
      }else{
        dateEl.textContent='すべてのコードが対応済みです';
        openBtn.removeAttribute('href');
        openBtn.classList.add('is-disabled');
        openBtn.textContent='未対応コードなし';
        guide.textContent='このリストの未対応コードはありません。';
      }
    }catch(error){
      cokeCurrentItem=null;
      countEl.textContent='確認失敗';
      dateEl.textContent='';
      openBtn.removeAttribute('href');
      openBtn.classList.add('is-disabled');
      openBtn.textContent='URLを開けません';
      guide.textContent='未対応コードの取得に失敗しました。';
      setStatus('コークオン未対応コードの確認に失敗しました: '+error.message,false);
    }
  }

  async function completeCokeOnItem(){
    if(!cokeCurrentItem)return;
    const submissionId=cokeCurrentItem.id;
    const listId=cokeCurrentListId;
    const button=document.getElementById('cokeOnCompleteBtn');
    try{
      button.disabled=true;
      await call('/api/cokeon-complete/'+encodeURIComponent(submissionId),{method:'POST',body:'{}'});
      await loadAll();
      await loadCokeOnNext(listId);
      setStatus('コークオン対応済みとして記録し、次のURLを準備しました ✓');
    }catch(error){
      button.disabled=false;
      setStatus('コークオン対応完了の記録に失敗しました: '+error.message,false);
    }
  }

  function decorateCokeOnCards(){
    if(typeof currentLists==='undefined')return;
    currentLists.filter(isCokeOnList).forEach(item=>{
      document.querySelectorAll(`.listItem[data-list-id="${CSS.escape(String(item.id))}"]`).forEach(card=>{
        const button=card.querySelector('.cardCopyBtn');
        if(!button)return;
        const label=button.querySelector('.cardCopyLabel');
        if(label)label.textContent='未対応';
        button.setAttribute('aria-label',`${item.name}の未対応データ ${Number(item.unprocessed_count||0)}件`);
      });
    });
  }

  if(typeof renderLists==='function'){
    const originalRenderLists=renderLists;
    renderLists=function(lists){
      originalRenderLists(lists);
      decorateCokeOnCards();
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
      if(!isCokeOnList(item))return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openCokeOnFlow(item);
    },true);
  }

  ensureCokeModal();
  decorateCokeOnCards();
})();
