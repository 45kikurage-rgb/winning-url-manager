(function () {
  'use strict';
  window.LayoutAccountReset = {
    create({$, esc, getData, call, status, statusName, refresh}) {
      const storageKey='winning-layout-account-reset-pending-v1';
      let busy=false, pending=null;
      try { pending=JSON.parse(localStorage.getItem(storageKey)||'null'); } catch {}
      const activeAccounts=()=>getData().accounts.filter(row=>Number(row.is_active)!==0);
      const selectedIds=()=>Array.from($('resetCampaigns').querySelectorAll('input:checked')).map(input=>input.value);
      function switchTab(reset) {
        for(const [id,on] of [['correctTab',!reset],['resetTab',reset]]){
          $(id).setAttribute('aria-selected',String(on));
          $(id).tabIndex=on?0:-1;
        }
        $('correctPane').hidden=reset;
        $('resetPane').hidden=!reset;
      }
      $('correctTab').onclick=()=>switchTab(false);
      $('resetTab').onclick=()=>switchTab(true);
      for(const id of ['correctTab','resetTab'])$(id).onkeydown=event=>{
        if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
          event.preventDefault();
          const reset=event.key==='End'||(event.key!=='Home'&&id==='correctTab');
          switchTab(reset);$(reset?'resetTab':'correctTab').focus();
        }
      };
      function lock() {
        const frozen=busy||!!pending;
        $('resetDevice').disabled=frozen;
        $('resetLine').disabled=frozen||!$('resetDevice').value;
        $('resetSelectAll').disabled=frozen;
        $('resetCampaigns').querySelectorAll('input').forEach(input=>input.disabled=frozen);
        $('resetSave').disabled=busy;
        $('resetSave').textContent=busy?'確認中…':pending?'前回の初期化結果を確認':'初期化内容を確認';
        $('resetPending').hidden=!pending;
        $('resetPending').textContent=pending?
          `端末${pending.device}／LINE${pending.line_number}／対象${pending.campaign_ids?.length||0}キャンペーン\n通信結果が未確認です。同じ操作の結果を確認します。`:'';
      }
      function renderLines() {
        const previous=$('resetLine').value;
        const rows=activeAccounts().filter(row=>String(row.device_id).padStart(2,'0')===$('resetDevice').value)
          .sort((a,b)=>Number(a.line_number)-Number(b.line_number));
        $('resetLine').innerHTML='<option value="">LINEを選択</option>'+rows.map(row=>
          `<option value="${esc(row.id)}">LINE ${esc(row.line_number||row.display_name)}</option>`).join('');
        if(rows.some(row=>row.id===previous))$('resetLine').value=previous;
        lock();
      }
      function render() {
        const previous=$('resetDevice').value, selected=new Set(selectedIds());
        const devices=[...new Set(activeAccounts().map(row=>String(row.device_id).padStart(2,'0')))].sort();
        $('resetDevice').innerHTML='<option value="">端末を選択</option>'+devices.map(device=>
          `<option value="${esc(device)}">端末 ${esc(device)}</option>`).join('');
        if(devices.includes(previous))$('resetDevice').value=previous;
        renderLines();
        const campaigns=getData().campaigns.filter(row=>row.status==='active');
        $('resetCampaigns').innerHTML=campaigns.map(row=>`<label class="resetChoice"><input type="checkbox" value="${esc(row.id)}" ${selected.has(row.id)?'checked':''}><span>${esc(row.name)}</span></label>`).join('')||'<p class="muted">開催中のキャンペーンがありません。</p>';
        const history=getData().history.filter(row=>row.source==='account-reset').slice(0,20);
        $('resetHistory').innerHTML=history.map(row=>`<div class="item">${esc(row.campaign_name)}／端末${esc(row.device_id)}／LINE${esc(row.line_number||row.display_name)}<br>${esc(statusName(row.old_status))} → 未抽選<br><span class="muted">${esc(row.changed_at)}</span></div>`).join('')||'<p class="muted">初期化履歴はありません。</p>';
        lock();
      }
      $('resetDevice').onchange=renderLines;
      $('resetSelectAll').onclick=()=>{
        const inputs=Array.from($('resetCampaigns').querySelectorAll('input'));
        const select=!inputs.length||!inputs.every(input=>input.checked);
        inputs.forEach(input=>input.checked=select);
      };
      $('resetSave').onclick=async()=>{
        if(busy)return;
        busy=true;lock();
        try{
          if(!pending){
            const device=$('resetDevice').value, accountId=$('resetLine').value, ids=selectedIds();
            if(!device||!accountId||!ids.length){status('端末・LINE・対象キャンペーンを選択してください。');return;}
            const preview=await call('/api/layout/results/reset/preview',{method:'POST',body:JSON.stringify({device,account_id:accountId,campaign_ids:ids})});
            const lines=preview.targets.map(row=>`${row.name}：${statusName(row.old_status)} → 未抽選${row.changed?'':'（変更なし）'}`);
            if(!confirm(`端末${preview.device}／LINE${preview.line_number}\n対象${preview.campaign_count}キャンペーン・変更${preview.change_count}件\n\n${lines.join('\n')}\n\n入れ替え前の当選実績は残ります。\n次回の配置編集で、対象キャンペーンへ自動復帰します。\nこの内容で初期化しますか？`))return;
            const request={device,account_id:accountId,campaign_ids:ids,preview_token:preview.preview_token,
              request_id:crypto.randomUUID(),confirm_reset:true,line_number:preview.line_number};
            // Persist before sending so a lost response/reload retries the same operation.
            localStorage.setItem(storageKey,JSON.stringify(request));
            pending=request;lock();
          }
          const result=await call('/api/layout/results/reset',{method:'POST',body:JSON.stringify(pending)});
          try{localStorage.removeItem(storageKey)}catch{}
          pending=null;
          let refreshFailed=false;
          try{await refresh()}catch{refreshFailed=true;}
          status(`端末${result.device}／LINE${result.line_number}\n対象${result.campaign_count}キャンペーンを自動復帰待ちにしました（当落変更${result.change_count}件）。入れ替え前の当選${result.preserved_winner_count}件を保存しました。`+
            (refreshFailed?'\n表示の再読み込みに失敗しました。画面を更新してください。':'')+
            '\n次回の配置編集で、対象キャンペーンのタイトル設定・未抽選側への配置を自動で行います。作成ファイルをNOVAで復元してください。');
        }catch(error){
          if(pending&&[400,409,426].includes(error.status)){
            try{localStorage.removeItem(storageKey)}catch{}
            pending=null;
          }
          status('当落を初期化できません：'+String(error?.message||error));
        }finally{busy=false;lock();}
      };
      lock();
      return {render};
    }
  };
})();
