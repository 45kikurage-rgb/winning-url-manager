(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LayoutSafety=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const VERSION='2026-09-26-layout-safety-v1';
  const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
  const normalize=rows=>(rows||[]).map(a=>[String(a.app_id??a.appId),Number(a.screen),Number(a.cell_x??a.cellX),Number(a.cell_y??a.cellY),Number(a.line_number??a.lineNumber)]).sort((a,b)=>a[0].localeCompare(b[0]));
  function assertCanonical(context,local){
    if(context.safety_version!==VERSION)fail('E_CLIENT_UPDATE_REQUIRED','配置安全性のAPI版が一致しません。画面を更新してください。');
    if(JSON.stringify(normalize(context.accounts))!==JSON.stringify(normalize(local)))fail('E_CANONICAL_MISMATCH','端末内の固定初期配置とサーバー正本が一致しません。初期データ更新で確認してください。');
    return context;
  }
  function assertRevision(context,expected){
    if(context.safety_version!==VERSION||context.canonical_revision!==expected.canonical_revision||context.layout_revision!==expected.layout_revision)fail('E_CANONICAL_REVISION','正本またはキャンペーンが変わりました。解析し直してください。');
  }
  function excludeRetired(layout,context){
    const retired=new Set(context.retired_app_ids||[]),current=new Set(context.accounts.map(a=>a.app_id));
    if([...retired].some(id=>current.has(id)))fail('E_CANONICAL_MISMATCH','現役と旧世代が重複しています。');
    for(const group of layout.groups||[]){
      group.excludedRetired=[...(group.active||[]),...(group.winners||[])].filter(x=>retired.has(x.appId)).map(x=>x.appId);
      group.active=(group.active||[]).filter(x=>!retired.has(x.appId));
      group.winners=(group.winners||[]).filter(x=>!retired.has(x.appId));
    }
    return layout;
  }
  return {VERSION,assertCanonical,assertRevision,excludeRetired};
});
