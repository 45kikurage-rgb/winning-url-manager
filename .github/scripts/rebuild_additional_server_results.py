from pathlib import Path
import re

p=Path('home-layout-edit.html')
s=p.read_text()
# Additional mode must not require row 7. Default mode validates it inside its own branch.
s=s.replace("    if(!row7Packages.length)throw new Error('1ページ目の7段目にLINEがありません。');\n\n", "", 1)
start=s.index("    const start=Number($('rangeStart').value);")
end=s.index("    const preview=await apiCall('/api/layout/results/preview'", start)
new="""    const start=Number($('rangeStart').value);
    const end=Number($('rangeEnd').value);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start)throw new Error('作業範囲の開始番号と終了番号を正しく入力してください。');
    const workTarget=selectedWorkTarget();
    const device=$('device').value;
    const accountRows=[...byPackage.entries()].map(([appId,row])=>({app_id:appId,line_number:row.lineNumber,display_name:String(row.title||row.lineNumber)}));
    await apiCall('/api/layout/accounts/sync',{method:'POST',body:JSON.stringify({device,accounts:accountRows})});
    const campaignRecord=await ensureCampaign(campaign);
    let workRows;
    let updates;
    let additionalVisibleSet=new Set();

    if(workTarget==='default'){
      if(!row7Packages.length)throw new Error('1ページ目の7段目にLINEがありません。');
      workRows=[...byPackage.entries()].filter(([,row])=>row.lineNumber>=start&&row.lineNumber<=end).map(([id,row])=>({id,row}));
      if(!workRows.length)throw new Error('指定した作業範囲にLINEアカウントがありません。');
      const outside=matched.filter(id=>!workRows.some(item=>item.id===id));
      if(outside.length)throw new Error('7段目のLINEに作業範囲外のアカウントが含まれています。範囲を確認してください。');
      const rowResult=selectedResult();
      const otherResult=rowResult==='winner'?'loser':'winner';
      updates=workRows.map(item=>({account_id:device+':'+item.id,status:row7Set.has(item.id)?rowResult:otherResult}));
    }else{
      // 追加ページは配置ログではなくサーバー当落表を正とする。
      // 現在の外れを初期LINE順に並べ、それを追加ページの1番目〜として範囲指定する。
      const before=await apiCall('/api/layout/results?campaign_id='+encodeURIComponent(campaignRecord.id)+'&device='+encodeURIComponent(device));
      const serverLosers=new Set((before.accounts||[]).filter(row=>row.status==='loser').map(row=>row.app_id));
      const additionalIds=priority.filter(id=>serverLosers.has(id));
      workRows=additionalIds.slice(start-1,end).map(id=>({id,row:byPackage.get(id)})).filter(item=>item.row);
      if(!workRows.length)throw new Error('サーバーの当落表に、指定した追加ページ範囲の外れアカウントがありません。');

      // 追加ページ生成時のアイコンは title がキャンペーン名。
      // 指定範囲内で5×6に残ったものだけ当選。消去・ドック・7段目等は外れ継続。
      additionalVisibleSet=new Set(afterRows.filter(row=>
        Number(row.container)===-100&&Number(row.itemType)===0&&
        Number(row.cellY)>=0&&Number(row.cellY)<=5&&isLine(row)&&
        String(row.title||'')===campaign
      ).map(row=>packageId(row.intent)).filter(Boolean));
      updates=workRows.map(item=>({account_id:device+':'+item.id,status:additionalVisibleSet.has(item.id)?'winner':'loser'}));
    }
"""
s=s[:start]+new+s[end:]

summary_start=s.index("    const summary=[", s.index("async function analyze"))
summary_end=s.index("    $('summary').innerHTML", summary_start)
summary="""    const summary=[
      ['初期LINE',byPackage.size+'件'],
      [workTarget==='additional'?'5×6残存':'7段目LINE',workTarget==='additional'?workRows.filter(item=>additionalVisibleSet.has(item.id)).length+'件':row7Packages.length+'件'],
      ['抽選した範囲',workRows.length+'件'],
      ['対象LINE',workRows.map(item=>item.row?.lineNumber).filter(Number.isFinite).join('・')||'--'],
      ['初期にないID',missing.length+'件']
    ];
"""
s=s[:summary_start]+summary+s[summary_end:]
s=s.replace("    if(!matched.length){\n      analysis.workingDb.close();", "    if(workTarget==='default'&&!matched.length){\n      analysis.workingDb.close();", 1)
s=s.replace("rule:{canonicalRows:'1-6',judgementArea:'page1-row7-all-line',dock:'keep-after-draw',campaignUpdate:'server-results'}", "rule:{canonicalRows:'1-6',defaultJudgement:'page1-row7',additionalJudgement:'server-losers-and-campaign-5x6-remain-winner',dock:'outside-additional-5x6-is-loser',campaignUpdate:'server-results'}", 1)
p.write_text(s)

sw=Path('sw.js')
t=sw.read_text()
t=re.sub(r"const CACHE='[^']+';", "const CACHE='winning-url-manager-share-v35-server-additional-draw';", t, count=1)
sw.write_text(t)
