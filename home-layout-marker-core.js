(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.HomeLayoutMarkerCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DESKTOP=-100;
  const ITEM_APP=0;
  const ITEM_FOLDER=2;
  const WORK_COLUMNS=5;
  const ACTIVE_ROWS=6;
  const WINNER_ROW=6;
  const START_SUFFIX='始';
  const END_TITLE='配置終';
  const MAX_CAMPAIGNS=5;
  const BOOTSTRAP_URL_TITLES=new Set(['URL送信','URL当選管理','プレモル始','タコハイ始',END_TITLE]);

  const number=value=>Number(value);
  const titleOf=row=>String(row?.title||'').trim();
  const packageId=intent=>{
    const match=String(intent||'').match(/(?:component|package)=([^/;]+)/i);
    return match?match[1]:'';
  };
  const componentId=intent=>{
    const match=String(intent||'').match(/component=([^;]+)/i);
    return match?match[1]:'';
  };
  const isLine=row=>/^jp\.naver\.line\./i.test(packageId(row?.intent));
  const looksLikeMarkerTitle=title=>title===END_TITLE||(title.endsWith(START_SUFFIX)&&title.length>START_SUFFIX.length);
  const isDesktop=row=>number(row?.container)===DESKTOP;
  const isMarkerPosition=row=>number(row?.cellX)===0&&number(row?.cellY)===WINNER_ROW;
  const isWebApk=row=>/^org\.chromium\.webapk\./i.test(packageId(row?.intent));
  const labelsFor=campaign=>[String(campaign?.name||'').trim(),...(campaign?.aliases||[]).map(value=>String(value||'').trim())].filter(Boolean);

  function resolveCampaign(markerLabel,campaigns){
    const active=(campaigns||[]).filter(row=>String(row.status||'active')==='active');
    const exact=active.filter(campaign=>labelsFor(campaign).includes(markerLabel));
    if(exact.length===1)return exact[0];
    if(exact.length>1)throw new Error('「'+markerLabel+'」に一致するキャンペーンが複数あります。管理画面の名称を確認してください。');
    const prefix=active.filter(campaign=>labelsFor(campaign).some(label=>label.startsWith(markerLabel)||markerLabel.startsWith(label)));
    if(prefix.length===1)return prefix[0];
    if(prefix.length>1)throw new Error('「'+markerLabel+'」からキャンペーンを一意に判別できません。マーカー名を長くしてください。');
    throw new Error('開始マーカー「'+markerLabel+START_SUFFIX+'」に一致する登録中キャンペーンがありません。');
  }

  function labelMatchesCampaign(title,campaign,markerLabel){
    return title===markerLabel||labelsFor(campaign).includes(title);
  }

  function markerCandidates(rows){
    return (rows||[]).filter(row=>looksLikeMarkerTitle(titleOf(row)));
  }

  function collectMarkerLayout(rows,campaigns,defaultScreens){
    const candidates=markerCandidates(rows);
    if(!candidates.length)return null;
    const defaultSet=new Set((defaultScreens||[]).map(number).filter(Number.isFinite));
    if(!defaultSet.size)throw new Error('固定済みのデフォルトページを確認できません。');
    const maxDefault=Math.max(...defaultSet);

    for(const row of candidates){
      if(!isDesktop(row)||number(row.itemType)!==ITEM_APP||!isMarkerPosition(row)||!isWebApk(row)){
        throw new Error('マーカー「'+titleOf(row)+'」は、追加ページの7段目左端にURL送信アイコンとして置いてください。');
      }
      if(number(row.screen)<=maxDefault)throw new Error('マーカー「'+titleOf(row)+'」がデフォルトページ内にあります。追加ページへ移動してください。');
    }

    const ends=candidates.filter(row=>titleOf(row)===END_TITLE);
    const starts=candidates.filter(row=>titleOf(row)!==END_TITLE);
    if(ends.length!==1)throw new Error('「'+END_TITLE+'」マーカーは1個だけ必要です。現在'+ends.length+'個です。');
    if(!starts.length)throw new Error('キャンペーンの開始マーカー（例：プレモル始）がありません。');
    if(starts.length>MAX_CAMPAIGNS)throw new Error('開始マーカーは最大'+MAX_CAMPAIGNS+'キャンペーンまでです。');
    const allComponents=new Set(candidates.map(row=>componentId(row.intent)).filter(Boolean));
    if(allComponents.size!==1)throw new Error('開始・終了マーカーのアプリが一致しません。同じURL送信アイコンを複製してください。');

    const startScreens=new Set();
    const campaignIds=new Set();
    const orderedStarts=starts.map(row=>{
      const label=titleOf(row).slice(0,-START_SUFFIX.length).trim();
      const campaign=resolveCampaign(label,campaigns);
      const screen=number(row.screen);
      if(startScreens.has(screen))throw new Error('同じページに開始マーカーが複数あります。1ページにつき1個にしてください。');
      if(campaignIds.has(String(campaign.id)))throw new Error('「'+campaign.name+'」の開始マーカーが重複しています。');
      startScreens.add(screen);campaignIds.add(String(campaign.id));
      return {label,campaign,marker:row,startScreen:screen};
    }).sort((a,b)=>a.startScreen-b.startScreen);

    const endMarker=ends[0];
    const endScreen=number(endMarker.screen);
    if(orderedStarts.some(group=>group.startScreen>=endScreen))throw new Error('「'+END_TITLE+'」は、すべてのキャンペーン開始ページより後へ置いてください。');

    const allRows=rows||[];
    const additionalRows=allRows.filter(row=>isDesktop(row)&&number(row.screen)>maxDefault);
    const childrenByContainer=new Map();
    for(const row of allRows){
      const container=number(row.container);
      if(!Number.isFinite(container)||container===DESKTOP)continue;
      const children=childrenByContainer.get(container)||[];
      children.push(row);
      childrenByContainer.set(container,children);
    }
    const additionalScreens=[...new Set(additionalRows.map(row=>number(row.screen)).filter(Number.isFinite))].sort((a,b)=>a-b);
    if(!additionalScreens.length||orderedStarts[0].startScreen!==additionalScreens[0]){
      throw new Error('最初の追加ページ左下に、最初のキャンペーン開始マーカーを置いてください。');
    }
    if(endScreen!==additionalScreens[additionalScreens.length-1])throw new Error('「'+END_TITLE+'」の後にページ項目があります。終了マーカーを最後のページへ置いてください。');

    const occupied=new Map();
    for(const row of additionalRows){
      const x=number(row.cellX),y=number(row.cellY),screen=number(row.screen);
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>=WORK_COLUMNS||y<0||y>WINNER_ROW){
        throw new Error('追加ページに5列×7段の範囲外の項目があります。画面配置を確認してください。');
      }
      const key=screen+':'+x+':'+y;
      if(occupied.has(key))throw new Error('追加ページの同じ位置に項目が重なっています。画面配置を確認してください。');
      occupied.set(key,row);
    }

    const markerIds=new Set(candidates.map(row=>number(row._id)));
    const groups=orderedStarts.map((group,index)=>{
      const nextScreen=index+1<orderedStarts.length?orderedStarts[index+1].startScreen:endScreen;
      const blockRows=additionalRows.filter(row=>number(row.screen)>=group.startScreen&&number(row.screen)<nextScreen)
        .sort((a,b)=>number(a.screen)-number(b.screen)||number(a.cellY)-number(b.cellY)||number(a.cellX)-number(b.cellX)||number(a._id)-number(b._id));
      const active=[];const winners=[];const usedPackages=new Set();
      const addLine=(lineRow,placementRow,insideFolder)=>{
        if(number(lineRow.itemType)!==ITEM_APP||!isLine(lineRow)){
          throw new Error('「'+group.label+'」の範囲'+(insideFolder?'のフォルダ内':'')+'にLINE以外の項目があります。マーカーとLINEだけにしてください。');
        }
        const appId=packageId(lineRow.intent);
        const title=titleOf(lineRow);
        if(!labelMatchesCampaign(title,group.campaign,group.label)){
          throw new Error('「'+group.label+'」の範囲'+(insideFolder?'のフォルダ内':'')+'に別ラベル「'+(title||'名称なし')+'」のLINEがあります。');
        }
        if(usedPackages.has(appId))throw new Error('「'+group.label+'」内で同じLINEアカウントが重複しています：'+appId);
        usedPackages.add(appId);
        // フォルダ内のLINEも、親フォルダが置かれた段で判定する。
        // 1～6段目は残り、7段目は当選。
        if(number(placementRow.cellY)<ACTIVE_ROWS)active.push({appId,row:lineRow});
        else winners.push({appId,row:lineRow});
      };
      for(const row of blockRows){
        if(markerIds.has(number(row._id)))continue;
        const children=childrenByContainer.get(number(row._id))||[];
        if(children.length){
          if(number(row.itemType)!==ITEM_FOLDER){
            throw new Error('「'+group.label+'」の範囲にLINE以外の項目があります。マーカーとLINEだけにしてください。');
          }
          const orderedChildren=[...children].sort((a,b)=>number(a.rank)-number(b.rank)||number(a.screen)-number(b.screen)||number(a.cellY)-number(b.cellY)||number(a.cellX)-number(b.cellX)||number(a._id)-number(b._id));
          for(const child of orderedChildren)addLine(child,row,true);
          continue;
        }
        addLine(row,row,false);
      }
      return {...group,endScreen:nextScreen-1,active,winners};
    });

    const endExtras=additionalRows.filter(row=>number(row.screen)===endScreen&&!markerIds.has(number(row._id)));
    if(endExtras.length)throw new Error('「'+END_TITLE+'」ページには終了マーカー以外を置かないでください。');

    return {
      mode:'marker',
      maxDefault,
      markerComponent:[...allComponents][0],
      endMarker,
      endScreen,
      additionalScreens,
      groups
    };
  }

  function collectBootstrapLayout(rows,campaigns,defaultScreens,lineNumbersByPackage){
    const defaultSet=new Set((defaultScreens||[]).map(number).filter(Number.isFinite));
    if(defaultSet.size!==5)throw new Error('固定済みのデフォルトページを5ページ確認できません。');
    const maxDefault=Math.max(...defaultSet);
    const allRows=rows||[];
    const additionalRows=allRows.filter(row=>isDesktop(row)&&number(row.screen)>maxDefault);
    const additionalScreens=[...new Set(additionalRows.map(row=>number(row.screen)).filter(Number.isFinite))].sort((a,b)=>a-b);
    if(additionalScreens.length<2)throw new Error('初回設定には、6ページ目のプレモルと7ページ目のタコハイが必要です。');

    const markerSources=allRows.filter(row=>number(row.itemType)===ITEM_APP&&isWebApk(row)&&BOOTSTRAP_URL_TITLES.has(titleOf(row)));
    if(!markerSources.length)throw new Error('「URL送信」アプリを確認できません。ホーム画面またはドックに1個置いてください。');
    const markerComponents=new Set(markerSources.map(row=>componentId(row.intent)).filter(Boolean));
    if(markerComponents.size!==1)throw new Error('URL送信アプリが複数種類あります。使用するアプリを1種類にそろえてください。');
    const markerComponent=[...markerComponents][0];
    if(!markerComponent)throw new Error('URL送信アプリの識別情報を確認できません。');
    const markerTemplate=markerSources.find(row=>titleOf(row)==='URL送信')
      ||markerSources.find(row=>titleOf(row)==='URL当選管理')
      ||markerSources[0];

    const definitions=[
      {label:'プレモル',screen:additionalScreens[0],range:{start:1,end:150}},
      {label:'タコハイ',screen:additionalScreens[1],range:{start:1,end:45}}
    ];
    const groups=definitions.map(definition=>({
      ...definition,
      campaign:resolveCampaign(definition.label,campaigns),
      marker:markerTemplate,
      startScreen:definition.screen,
      endScreen:definition.screen,
      active:[],
      winners:[]
    }));
    const groupByScreen=new Map(groups.map(group=>[group.screen,group]));
    const usedPackages=new Map(groups.map(group=>[group.screen,new Set()]));
    const occupied=new Map();
    const childrenByContainer=new Map();
    for(const row of allRows){
      const container=number(row.container);
      if(!Number.isFinite(container)||container===DESKTOP)continue;
      const children=childrenByContainer.get(container)||[];
      children.push(row);
      childrenByContainer.set(container,children);
    }
    const lineNumberFor=appId=>{
      const value=lineNumbersByPackage instanceof Map?lineNumbersByPackage.get(appId):lineNumbersByPackage?.[appId];
      return number(value&&typeof value==='object'?(value.lineNumber??value.line_number):value);
    };
    const addLine=(group,row,insideFolder,placementRow=row)=>{
      if(number(row.itemType)!==ITEM_APP||!isLine(row)){
        throw new Error((group.label==='プレモル'?'6ページ目':'7ページ目')+(insideFolder?'のフォルダ内':'')+'にLINE以外の項目があります。');
      }
      const appId=packageId(row.intent);
      if(!appId||!Number.isInteger(lineNumberFor(appId)))throw new Error('固定初期データにないLINEがあります：'+(titleOf(row)||appId||'識別不能'));
      if(!labelMatchesCampaign(titleOf(row),group.campaign,group.label)){
        throw new Error((group.label==='プレモル'?'6ページ目':'7ページ目')+(insideFolder?'のフォルダ内':'')+'に別キャンペーン名「'+(titleOf(row)||'名称なし')+'」のLINEがあります。');
      }
      const used=usedPackages.get(group.screen);
      if(used.has(appId))throw new Error('同じLINEアカウントが重複しています：'+appId);
      used.add(appId);
      const line=lineNumberFor(appId);
      if(group.label==='タコハイ'&&line>45){
        throw new Error('7ページ目に未着手範囲のLINE'+line+'があります。タコハイは1～45の未当選だけを置いてください。');
      }
      if(number(placementRow.cellY)<ACTIVE_ROWS)group.active.push({appId,row});
      else group.winners.push({appId,row});
    };

    const orderedAdditionalRows=[...additionalRows].sort((a,b)=>number(a.screen)-number(b.screen)||number(a.cellY)-number(b.cellY)||number(a.cellX)-number(b.cellX)||number(a._id)-number(b._id));
    for(const row of orderedAdditionalRows){
      const screen=number(row.screen),x=number(row.cellX),y=number(row.cellY);
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>=WORK_COLUMNS||y<0||y>WINNER_ROW){
        throw new Error('6ページ目以降に5列×7段の範囲外の項目があります。画面配置を確認してください。');
      }
      const position=screen+':'+x+':'+y;
      if(occupied.has(position))throw new Error('6ページ目以降の同じ位置に項目が重なっています。画面配置を確認してください。');
      occupied.set(position,row);

      const group=groupByScreen.get(screen);
      if(number(row.itemType)===ITEM_APP&&isWebApk(row)&&BOOTSTRAP_URL_TITLES.has(titleOf(row))){
        if(componentId(row.intent)!==markerComponent)throw new Error('追加ページのURL送信アプリが別のアプリです。');
        continue;
      }
      if(!group){
        throw new Error('7ページ目より後に既存項目があります。初回設定対象外のページを空にしてから実行してください。');
      }
      const children=childrenByContainer.get(number(row._id))||[];
      if(children.length){
        const orderedChildren=[...children].sort((a,b)=>number(a.screen)-number(b.screen)||number(a.cellY)-number(b.cellY)||number(a.cellX)-number(b.cellX)||number(a.rank)-number(b.rank)||number(a._id)-number(b._id));
        for(const child of orderedChildren)addLine(group,child,true,row);
      }else addLine(group,row,false);
    }

    for(const group of groups){
      const sorter=(a,b)=>number(a.row.cellY)-number(b.row.cellY)||number(a.row.cellX)-number(b.row.cellX)||number(a.row._id)-number(b.row._id);
      group.active.sort(sorter);
      group.winners.sort(sorter);
      group.campaign={...group.campaign,initial_draw_ranges:[group.range]};
      group.rangeSource='初回設定固定（'+group.range.start+'～'+group.range.end+'）';
    }
    return {
      mode:'bootstrap',
      maxDefault,
      markerComponent,
      markerTemplate,
      endMarker:markerTemplate,
      additionalScreens,
      groups
    };
  }

  function normalizeRanges(rows){
    const sorted=(Array.isArray(rows)?rows:[]).map(row=>({start:number(row.start??row.range_start),end:number(row.end??row.range_end)}))
      .filter(row=>Number.isInteger(row.start)&&Number.isInteger(row.end)&&row.start>=1&&row.end>=row.start&&row.end<=150)
      .sort((a,b)=>a.start-b.start||a.end-b.end);
    const merged=[];
    for(const row of sorted){
      const last=merged[merged.length-1];
      if(last&&row.start<=last.end+1)last.end=Math.max(last.end,row.end);
      else merged.push({...row});
    }
    return merged;
  }

  function rangeContains(ranges,lineNumber){
    return ranges.some(row=>lineNumber>=row.start&&lineNumber<=row.end);
  }

  function displayLine(account){
    return 'LINE'+String(account?.line_number||account?.display_name||'--').padStart(2,'0');
  }

  function planCampaign(group,accounts,priority){
    const canonical=new Set(priority||[]);
    const byPackage=new Map();
    for(const account of accounts||[]){
      const appId=String(account.app_id||'');
      if(!appId||byPackage.has(appId))throw new Error('「'+group.label+'」のサーバーアカウント情報に空欄または重複があります。');
      if(!canonical.has(appId))throw new Error('「'+group.label+'」に固定初期データ以外のアカウントがあります：'+appId);
      const line=number(account.line_number);
      if(!Number.isInteger(line)||line<1)throw new Error('「'+group.label+'」にLINE番号不明のアカウントがあります。');
      const status=String(account.status||'undrawn');
      if(!['winner','loser','undrawn','hold'].includes(status))throw new Error('「'+group.label+'」に不正な当落状態があります。');
      if(status==='hold')throw new Error('「'+group.label+'」に判定保留があります。管理画面で訂正してから実行してください：'+displayLine(account));
      byPackage.set(appId,{...account,status,line_number:line});
    }
    const missingServer=(priority||[]).filter(appId=>!byPackage.has(appId));
    if(missingServer.length)throw new Error('「'+group.label+'」のサーバー情報が固定初期データより不足しています。同期し直してください。');

    const activeSet=new Set(group.active.map(item=>item.appId));
    const winnerSet=new Set(group.winners.map(item=>item.appId));
    for(const appId of [...activeSet,...winnerSet]){
      if(!canonical.has(appId))throw new Error('「'+group.label+'」に固定初期データにないLINEがあります：'+appId);
      if(!byPackage.has(appId))throw new Error('「'+group.label+'」にサーバー未登録のLINEがあります：'+appId);
    }

    const misplacedWinners=[];
    for(const appId of activeSet){
      const account=byPackage.get(appId);
      if(account.status==='winner')misplacedWinners.push(displayLine(account));
    }
    if(misplacedWinners.length)throw new Error('当選済みアカウントが1～6段目にあります。再配置は行いません。\n「'+group.label+'」：'+misplacedWinners.join('・'));

    const presentSet=new Set([...activeSet,...winnerSet]);
    const unexplainedMissing=[];
    for(const appId of priority||[]){
      const account=byPackage.get(appId);
      if(!presentSet.has(appId)&&account.status!=='winner')unexplainedMissing.push(displayLine(account));
    }
    if(unexplainedMissing.length){
      throw new Error('当選履歴のないLINEが追加ページから消えています。誤削除の可能性があるため停止しました。\n「'+group.label+'」：'+unexplainedMissing.slice(0,20).join('・')+(unexplainedMissing.length>20?' ほか'+(unexplainedMissing.length-20)+'件':''));
    }

    // 1～6段目は「未抽選またはハズレ」をまとめて残りとして扱う。
    // 7段目は、直接配置とフォルダ内のどちらも今回の新規当選とする。
    const updates=[];
    for(const appId of priority||[]){
      const account=byPackage.get(appId);
      const status=winnerSet.has(appId)||account.status==='winner'?'winner':'loser';
      updates.push({account_id:String(account.account_id),status});
    }
    const placementIds=(priority||[]).filter(appId=>activeSet.has(appId));
    const loserIds=[...placementIds];
    const undrawnIds=[];
    return {
      ...group,
      accounts:[...byPackage.values()],
      updates,
      placementIds,
      loserIds,
      undrawnIds,
      activeCount:activeSet.size,
      winnerRowCount:winnerSet.size,
      previousWinnerCount:(priority||[]).filter(appId=>byPackage.get(appId)?.status==='winner'&&!winnerSet.has(appId)).length,
      totalCount:(priority||[]).length
    };
  }

  function accountMapForCampaign(label,accounts,priority){
    const canonical=new Set(priority||[]);
    const byPackage=new Map();
    for(const account of accounts||[]){
      const appId=String(account.app_id||'');
      if(!appId||byPackage.has(appId))throw new Error('「'+label+'」のサーバーアカウント情報に空欄または重複があります。');
      if(!canonical.has(appId))throw new Error('「'+label+'」に固定初期データ以外のアカウントがあります：'+appId);
      const line=number(account.line_number);
      if(!Number.isInteger(line)||line<1)throw new Error('「'+label+'」にLINE番号不明のアカウントがあります。');
      const status=String(account.status||'undrawn');
      if(!['winner','loser','undrawn','hold'].includes(status))throw new Error('「'+label+'」に不正な当落状態があります。');
      if(status==='hold')throw new Error('「'+label+'」に判定保留があります。管理画面で訂正してから実行してください：'+displayLine(account));
      byPackage.set(appId,{...account,status,line_number:line});
    }
    const missing=(priority||[]).filter(appId=>!byPackage.has(appId));
    if(missing.length)throw new Error('「'+label+'」のサーバー情報が固定初期データより不足しています。同期し直してください。');
    return byPackage;
  }

  function planNewCampaign(campaign,markerTemplate,accounts,priority,pageCount=5){
    const label=String(campaign?.name||'').trim();
    if(!label)throw new Error('追加するキャンペーン名を確認できません。');
    const pages=number(pageCount);
    if(!Number.isInteger(pages)||pages<1)throw new Error('追加ページ数が不正です。');
    const capacity=pages*WORK_COLUMNS*ACTIVE_ROWS;
    if(!(priority||[]).length||(priority||[]).length>capacity){
      throw new Error('「'+label+'」を'+pages+'ページに配置できるLINE数を超えています。現在'+(priority||[]).length+'件です。');
    }
    const byPackage=accountMapForCampaign(label,accounts,priority);
    const decided=[...byPackage.values()].filter(account=>account.status!=='undrawn');
    if(decided.length){
      throw new Error('「'+label+'」には既に当落履歴があります。新規キャンペーンとして追加できません：'+decided.slice(0,20).map(displayLine).join('・')+(decided.length>20?' ほか'+(decided.length-20)+'件':''));
    }
    return {
      label,
      campaign,
      marker:markerTemplate,
      active:[],
      winners:[],
      ranges:[],
      accounts:[...byPackage.values()],
      updates:[...byPackage.values()].map(account=>({account_id:String(account.account_id),status:'undrawn'})),
      placementIds:[...(priority||[])],
      loserIds:[],
      undrawnIds:[...(priority||[])],
      activeCount:0,
      winnerRowCount:0,
      previousWinnerCount:0,
      totalCount:(priority||[]).length,
      fixedPageCount:pages,
      isNewCampaign:true
    };
  }

  function orderCampaignPlans(plans,campaigns){
    const order=new Map((campaigns||[]).map((campaign,index)=>[String(campaign.id),index]));
    const unknown=(plans||[]).filter(plan=>!order.has(String(plan?.campaign?.id)));
    if(unknown.length)throw new Error('キャンペーン配置順を確認できません：'+unknown.map(plan=>plan.label||plan?.campaign?.name||'名称なし').join('・'));
    return (plans||[]).map((plan,index)=>({plan,index})).sort((a,b)=>
      order.get(String(a.plan.campaign.id))-order.get(String(b.plan.campaign.id))||a.index-b.index
    ).map(item=>item.plan);
  }

  function verifyGeneratedLayout(layout,plans){
    if(!layout)throw new Error('作成後の開始・終了マーカーを確認できません。');
    if(layout.groups.length!==plans.length)throw new Error('作成後のキャンペーン数が一致しません。');
    for(let index=0;index<plans.length;index++){
      const actual=layout.groups[index];
      const expected=plans[index];
      if(String(actual.campaign.id)!==String(expected.campaign.id))throw new Error('作成後のキャンペーン順が一致しません。');
      const actualIds=actual.active.map(item=>item.appId);
      if(actual.winners.length)throw new Error('作成後の7段目に当選LINEが残っています。');
      if(actualIds.length!==expected.placementIds.length||actualIds.some((id,i)=>id!==expected.placementIds[i])){
        throw new Error('作成後の「'+expected.label+'」配置が判定結果と一致しません。');
      }
    }
    return true;
  }

  function updateNovaXml(xml,screenCount,defaultPage){
    const text=String(xml||'');
    const screens=number(screenCount),home=number(defaultPage);
    if(!Number.isInteger(screens)||screens<1||!Number.isInteger(home)||home<0||home>=screens)throw new Error('Novaのページ数またはホーム位置が不正です。');
    const screenPattern=/<int name="workspace_screen_count" value="\d+"\s*\/>/;
    const defaultPattern=/<int name="desktop_default_page" value="\d+"\s*\/>/;
    if(!screenPattern.test(text)||!defaultPattern.test(text))throw new Error('Novaのページ設定を確認できません。');
    return text.replace(screenPattern,'<int name="workspace_screen_count" value="'+screens+'" />')
      .replace(defaultPattern,'<int name="desktop_default_page" value="'+home+'" />');
  }

  return {
    DESKTOP,ITEM_APP,ITEM_FOLDER,WORK_COLUMNS,ACTIVE_ROWS,WINNER_ROW,START_SUFFIX,END_TITLE,MAX_CAMPAIGNS,
    packageId,componentId,isLine,markerCandidates,collectMarkerLayout,collectBootstrapLayout,normalizeRanges,rangeContains,planCampaign,planNewCampaign,orderCampaignPlans,verifyGeneratedLayout,updateNovaXml
  };
});
