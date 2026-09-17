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
  const PAGE_FLAG_PATTERN=/^Page(\d+)$/i;
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
  const pageFlagNumber=title=>{
    const match=String(title||'').trim().match(PAGE_FLAG_PATTERN);
    if(!match)return null;
    const value=number(match[1]);
    return Number.isInteger(value)&&value>=1?value:null;
  };
  const isPageFlagTitle=title=>pageFlagNumber(title)!==null;
  const pageCountForItems=itemCount=>{
    const value=number(itemCount);
    if(!Number.isInteger(value)||value<0)throw new Error('配置件数が不正です。');
    return Math.ceil(value/(WORK_COLUMNS*ACTIVE_ROWS));
  };
  const pageFlagTitle=pageNumber=>{
    const value=number(pageNumber);
    if(!Number.isInteger(value)||value<1)throw new Error('ページ番号が不正です。');
    return 'Page'+String(value).padStart(2,'0');
  };

  function inspectPageFlags(rows,pageScreens){
    const screens=[...new Set((pageScreens||[]).map(number).filter(Number.isFinite))].sort((a,b)=>a-b);
    const expectedSet=new Set(screens);
    const flags=(rows||[]).filter(row=>isDesktop(row)&&number(row.itemType)===ITEM_APP&&isMarkerPosition(row)&&isWebApk(row)&&isPageFlagTitle(titleOf(row)));
    if(!flags.length){
      return {flags:[],warnings:['旧形式のフラグをPage形式へ更新します。'],legacy:true};
    }
    const warnings=[];
    const byScreen=new Map();
    for(const row of flags){
      const screen=number(row.screen);
      const list=byScreen.get(screen)||[];list.push(row);byScreen.set(screen,list);
      if(!expectedSet.has(screen))warnings.push(titleOf(row)+'が不要なページにあります。');
    }
    screens.forEach((screen,index)=>{
      const expected=pageFlagTitle(index+1);
      const found=byScreen.get(screen)||[];
      if(!found.length)warnings.push(expected+'がありません。');
      else if(found.length>1)warnings.push(expected+'の位置にページフラグが'+found.length+'個あります。');
      if(found.length&&titleOf(found[0])!==expected)warnings.push(expected+'の位置が「'+titleOf(found[0])+'」になっています。');
    });
    const numberCounts=new Map();
    for(const row of flags){
      const value=pageFlagNumber(titleOf(row));
      numberCounts.set(value,(numberCounts.get(value)||0)+1);
    }
    for(const [value,count] of numberCounts)if(count>1)warnings.push(pageFlagTitle(value)+'が'+count+'個あります。');
    return {flags,warnings:[...new Set(warnings)],legacy:false};
  }

  function verifyPageFlags(rows,pageScreens){
    const inspection=inspectPageFlags(rows,pageScreens);
    if(inspection.legacy||inspection.warnings.length)throw new Error('作成後のページフラグを確認できません。\n'+inspection.warnings.join('\n'));
    return true;
  }

  function resolveCampaign(markerLabel,campaigns){
    const registered=campaigns||[];
    const exact=registered.filter(campaign=>labelsFor(campaign).includes(markerLabel));
    if(exact.length===1)return exact[0];
    if(exact.length>1)throw new Error('「'+markerLabel+'」に一致するキャンペーンが複数あります。管理画面の名称を確認してください。');
    const prefix=registered.filter(campaign=>labelsFor(campaign).some(label=>label.startsWith(markerLabel)||markerLabel.startsWith(label)));
    if(prefix.length===1)return prefix[0];
    if(prefix.length>1)throw new Error('「'+markerLabel+'」からキャンペーンを一意に判別できません。マーカー名を長くしてください。');
    throw new Error('開始マーカー「'+markerLabel+START_SUFFIX+'」に一致する登録済みキャンペーンがありません。');
  }

  function labelMatchesCampaign(title,campaign,markerLabel){
    return title===markerLabel||labelsFor(campaign).includes(title);
  }

  function markerCandidates(rows){
    return (rows||[]).filter(row=>looksLikeMarkerTitle(titleOf(row)));
  }

  function campaignForTitle(title,campaigns){
    const exact=(campaigns||[]).filter(campaign=>labelsFor(campaign).includes(String(title||'').trim()));
    if(exact.length===1)return exact[0];
    if(exact.length>1)throw new Error('「'+title+'」に一致するキャンペーンが複数あります。管理画面の名称履歴を確認してください。');
    return null;
  }

  function resolveCampaignTitle(title,campaigns){
    const campaign=campaignForTitle(title,campaigns);
    if(campaign)return campaign;
    throw new Error('LINEのアプリタイトル「'+(title||'名称なし')+'」に一致するキャンペーンがありません。');
  }

  // Read every additional page by LINE title. Marker position and page boundaries
  // are intentionally ignored; markers are only visual guides in generated files.
  function collectTitleLayout(rows,campaigns,defaultScreens,resetPlacements=[]){
    const defaultSet=new Set((defaultScreens||[]).map(number).filter(Number.isFinite));
    if(!defaultSet.size)throw new Error('固定済みのデフォルトページを確認できません。');
    const maxDefault=Math.max(...defaultSet);
    const allRows=rows||[];
    const additionalRows=allRows.filter(row=>isDesktop(row)&&number(row.screen)>maxDefault);
    const additionalScreens=[...new Set(additionalRows.map(row=>number(row.screen)).filter(Number.isFinite))].sort((a,b)=>a-b);
    const childrenByContainer=new Map();
    for(const row of allRows){
      const container=number(row.container);
      if(!Number.isFinite(container)||container===DESKTOP)continue;
      const children=childrenByContainer.get(container)||[];
      children.push(row);childrenByContainer.set(container,children);
    }
    const markerSources=allRows.filter(row=>number(row.itemType)===ITEM_APP&&isWebApk(row));
    const markerTemplate=markerSources.find(row=>BOOTSTRAP_URL_TITLES.has(titleOf(row)))||markerSources[0]||null;
    const groupsById=new Map();
    const usedByCampaign=new Map();
    const resetIdsByCampaign=new Map();
    const resetCampaignsByApp=new Map();
    const campaignsById=new Map((campaigns||[]).map(campaign=>[String(campaign.id),campaign]));
    for(const placement of resetPlacements||[]){
      const id=String(placement.campaign_id||'');
      const values=resetIdsByCampaign.get(id)||new Set();
      values.add(String(placement.app_id||''));resetIdsByCampaign.set(id,values);
      const appId=String(placement.app_id||'');
      const campaignIds=resetCampaignsByApp.get(appId)||new Set();
      campaignIds.add(id);resetCampaignsByApp.set(appId,campaignIds);
    }
    const ensureGroup=(campaign,placementRow)=>{
      const id=String(campaign.id);
      let group=groupsById.get(id);
      if(!group){
        group={label:String(campaign.name||'').trim(),campaign,marker:markerTemplate,startScreen:number(placementRow.screen),endScreen:number(placementRow.screen),active:[],winners:[]};
        groupsById.set(id,group);usedByCampaign.set(id,new Set());
      }
      group.startScreen=Math.min(group.startScreen,number(placementRow.screen));
      group.endScreen=Math.max(group.endScreen,number(placementRow.screen));
      return group;
    };
    const addLine=(lineRow,placementRow,insideFolder)=>{
      if(number(lineRow.itemType)!==ITEM_APP||!isLine(lineRow)){
        throw new Error('追加ページ'+(insideFolder?'のフォルダ内':'')+'にLINE以外の項目があります。');
      }
      const appId=packageId(lineRow.intent);
      let campaign=campaignForTitle(titleOf(lineRow),campaigns);
      if(!campaign){
        const resetCampaignIds=resetCampaignsByApp.get(appId)||new Set();
        if(resetCampaignIds.size===1)campaign=campaignsById.get([...resetCampaignIds][0])||null;
        else if(resetCampaignIds.size>1)throw new Error('配置待ちLINEの旧タイトルからキャンペーンを一意に判別できません：'+appId);
      }
      if(!campaign)campaign=resolveCampaignTitle(titleOf(lineRow),campaigns);
      const id=String(campaign.id);
      const group=ensureGroup(campaign,placementRow);
      const used=usedByCampaign.get(id);
      const isReset=resetIdsByCampaign.get(id)?.has(appId);
      if(used.has(appId)&&isReset)return;
      if(used.has(appId))throw new Error('「'+group.label+'」内で同じLINEアカウントが重複しています：'+appId);
      used.add(appId);
      if(number(placementRow.cellY)<ACTIVE_ROWS)group.active.push({appId,row:lineRow});
      else group.winners.push({appId,row:lineRow});
    };
    const ordered=[...additionalRows].sort((a,b)=>number(a.screen)-number(b.screen)||number(a.cellY)-number(b.cellY)||number(a.cellX)-number(b.cellX)||number(a._id)-number(b._id));
    const occupied=new Set();
    for(const row of ordered){
      const x=number(row.cellX),y=number(row.cellY),screen=number(row.screen);
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>=WORK_COLUMNS||y<0||y>WINNER_ROW){
        throw new Error('追加ページに5列×7段の範囲外の項目があります。画面配置を確認してください。');
      }
      const position=screen+':'+x+':'+y;
      if(occupied.has(position))throw new Error('追加ページの同じ位置に項目が重なっています。画面配置を確認してください。');
      occupied.add(position);
      const children=childrenByContainer.get(number(row._id))||[];
      if(children.length){
        if(number(row.itemType)!==ITEM_FOLDER)throw new Error('追加ページにLINE以外の項目があります。');
        const sorted=[...children].sort((a,b)=>number(a.rank)-number(b.rank)||number(a._id)-number(b._id));
        for(const child of sorted)addLine(child,row,true);
      }else if(number(row.itemType)===ITEM_APP&&isLine(row))addLine(row,row,false);
      else if(number(row.itemType)===ITEM_APP&&isWebApk(row)){
        if(isPageFlagTitle(titleOf(row)))continue;
        const campaign=campaignForTitle(titleOf(row),campaigns);
        if(campaign)ensureGroup(campaign,row);
        continue;
      }
      else if(number(row.itemType)===ITEM_FOLDER)continue;
      else throw new Error('追加ページに判定対象外の項目があります。LINE・当選フォルダ・キャンペーン表示だけにしてください。');
    }
    const groups=[...groupsById.values()].sort((a,b)=>a.startScreen-b.startScreen||a.label.localeCompare(b.label,'ja'));
    const pageScreens=[...new Set([...defaultSet,...additionalScreens])].sort((a,b)=>a-b);
    const pageFlagInspection=inspectPageFlags(allRows,pageScreens);
    return {mode:'title',maxDefault,markerTemplate,endMarker:markerTemplate,additionalScreens,groups,pageFlags:pageFlagInspection.flags,pageFlagWarnings:pageFlagInspection.warnings,legacyPageFlags:pageFlagInspection.legacy};
  }

  function collectMarkerLayout(rows,campaigns,defaultScreens,resetPlacements=[]){
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
      const resetIds=new Set(resetPlacements.filter(p=>String(p.campaign_id)===String(group.campaign.id)).map(p=>p.app_id));
      const addLine=(lineRow,placementRow,insideFolder)=>{
        if(number(lineRow.itemType)!==ITEM_APP||!isLine(lineRow)){
          throw new Error('「'+group.label+'」の範囲'+(insideFolder?'のフォルダ内':'')+'にLINE以外の項目があります。マーカーとLINEだけにしてください。');
        }
        const appId=packageId(lineRow.intent);
        const title=titleOf(lineRow);
        if(!resetIds.has(appId)&&!labelMatchesCampaign(title,group.campaign,group.label)){
          throw new Error('「'+group.label+'」の範囲'+(insideFolder?'のフォルダ内':'')+'に別ラベル「'+(title||'名称なし')+'」のLINEがあります。');
        }
        if(usedPackages.has(appId)&&resetIds.has(appId))return;
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

    const resetAccounts=[...byPackage.values()].filter(account=>account.reset_id);
    if(resetAccounts.some(account=>account.status!=='undrawn'))throw new Error('配置待ちLINEの当落が変更されています。解析し直してください。');
    const resetSet=new Set(resetAccounts.map(account=>account.app_id));
    const activeSet=new Set([...group.active.map(item=>item.appId),...resetSet]);
    const winnerSet=new Set(group.winners.map(item=>item.appId).filter(id=>!resetSet.has(id)));
    for(const appId of [...activeSet,...winnerSet]){
      if(!canonical.has(appId))throw new Error('「'+group.label+'」に固定初期データにないLINEがあります：'+appId);
      if(!byPackage.has(appId))throw new Error('「'+group.label+'」にサーバー未登録のLINEがあります：'+appId);
    }

    const presentSet=new Set([...activeSet,...winnerSet]);
    const unexplainedMissing=[];
    for(const appId of priority||[]){
      const account=byPackage.get(appId);
      if(!presentSet.has(appId)&&account.status!=='winner')unexplainedMissing.push(displayLine(account));
    }
    if(unexplainedMissing.length){
      throw new Error('当選履歴のないLINEが追加ページから消えています。誤削除の可能性があるため停止しました。\n「'+group.label+'」：'+unexplainedMissing.slice(0,20).join('・')+(unexplainedMissing.length>20?' ほか'+(unexplainedMissing.length-20)+'件':''));
    }

    // The backup can be stale when an edited file was not restored. Winner is
    // monotonic: an old 1-6 row can never erase a server-side win. Rows 1-6
    // preserve loser/undrawn, while row 7 promotes the account to winner.
    const updates=[];
    for(const appId of priority||[]){
      const account=byPackage.get(appId);
      const status=resetSet.has(appId)?'undrawn':winnerSet.has(appId)||account.status==='winner'?'winner':account.status;
      updates.push({account_id:String(account.account_id),status});
    }
    const placementIds=(priority||[]).filter(appId=>activeSet.has(appId)&&(resetSet.has(appId)||byPackage.get(appId)?.status!=='winner'));
    const loserIds=placementIds.filter(id=>!resetSet.has(id)&&byPackage.get(id)?.status==='loser');
    const undrawnIds=placementIds.filter(id=>resetSet.has(id)||byPackage.get(id)?.status==='undrawn');
    return {
      ...group,
      accounts:[...byPackage.values()],
      updates,
      placementIds,
      loserIds,
      undrawnIds,
      resetPlacements:resetAccounts.map(account=>({account_id:String(account.account_id),reset_id:String(account.reset_id)})),
      newAccountCount:resetAccounts.filter(account=>String(account.reset_id).startsWith('new-line:')).length,
      activeCount:activeSet.size,
      winnerRowCount:[...winnerSet].filter(appId=>byPackage.get(appId)?.status!=='winner').length,
      previousWinnerCount:(priority||[]).filter(appId=>byPackage.get(appId)?.status==='winner').length,
      totalCount:(priority||[]).length,
      fixedPageCount:pageCountForItems(placementIds.length)
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
      resetPlacements:[...byPackage.values()].filter(account=>account.reset_id).map(account=>({account_id:String(account.account_id),reset_id:String(account.reset_id)})),
      activeCount:0,
      winnerRowCount:0,
      previousWinnerCount:0,
      totalCount:(priority||[]).length,
      fixedPageCount:pageCountForItems((priority||[]).length),
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
    if(!layout)throw new Error('作成後の追加ページを確認できません。');
    const expectedPlans=(plans||[]).filter(plan=>(plan.placementIds||[]).length>0);
    if(layout.groups.length!==expectedPlans.length)throw new Error('作成後のキャンペーン数が一致しません。');
    for(let index=0;index<expectedPlans.length;index++){
      const actual=layout.groups[index];
      const expected=expectedPlans[index];
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
    packageId,componentId,isLine,pageFlagNumber,isPageFlagTitle,pageCountForItems,pageFlagTitle,inspectPageFlags,verifyPageFlags,markerCandidates,collectTitleLayout,collectMarkerLayout,collectBootstrapLayout,normalizeRanges,rangeContains,planCampaign,planNewCampaign,orderCampaignPlans,verifyGeneratedLayout,updateNovaXml
  };
});
