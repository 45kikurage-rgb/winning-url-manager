const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../home-layout-marker-core.js');

const markerIntent='#Intent;component;component=org.chromium.webapk.marker/org.chromium.webapk.Main;end';
const lineIntent=id=>'#Intent;component='+id+'/.activity.SplashActivity;end';
const pkg=n=>'jp.naver.line.test'+String(n).padStart(3,'0');
const app=(id,title,screen,x,y,_id)=>({_id,title,intent:lineIntent(id),container:-100,screen,cellX:x,cellY:y,itemType:0});
const marker=(title,screen,_id)=>({_id,title,intent:markerIntent,container:-100,screen,cellX:0,cellY:6,itemType:0});
const urlSource=(component=markerIntent)=>({_id:90,title:'URL送信',intent:component,container:-101,screen:0,cellX:0,cellY:0,itemType:0});
const folder=(title,screen,x,y,_id)=>({_id,title,intent:null,container:-100,screen,cellX:x,cellY:y,itemType:2});
const folderApp=(id,title,container,index,_id)=>({_id,title,intent:lineIntent(id),container,screen:0,cellX:index%3,cellY:Math.floor(index/3),rank:index,itemType:0});

const campaigns=[
  {id:'premol',name:'プレモル',status:'active',aliases:[],initial_draw_ranges:[{start:1,end:150}]},
  {id:'taco',name:'タコハイボール',status:'active',aliases:[],initial_draw_ranges:[{start:1,end:45}]}
];
const premolNumbers=[28,38,41,96,122,124,125,129,130];
const tacoNumbers=[3,8,31,33,34,39,44,45];
const tacoRemaining=[...tacoNumbers,...Array.from({length:85},(_,index)=>index+46)];

function spatialApps(numbers,title,screen,startId){
  return numbers.map((n,index)=>app(pkg(n),title,screen,index%5,Math.floor(index/5),startId+index));
}
function pagedApps(numbers,title,screen,startId){
  return numbers.map((n,index)=>app(pkg(n),title,screen+Math.floor(index/30),index%5,Math.floor((index%30)/5),startId+index));
}
function layoutRows(){
  return [
    ...spatialApps(premolNumbers,'プレモル',7,1000),
    marker('プレモル始',7,1090),
    ...pagedApps(tacoRemaining,'タコハイボール',8,2000),
    marker('タコハイ始',8,2190),
    marker('配置終',12,2200)
  ];
}
function accounts(kind){
  const active=new Set(kind==='premol'?premolNumbers:tacoNumbers);
  return Array.from({length:130},(_,index)=>{
    const n=index+1;
    const status=kind==='premol'?(active.has(n)?'loser':'winner'):(n<=45?(active.has(n)?'loser':'winner'):'undrawn');
    return {account_id:'14:'+pkg(n),device_id:'14',line_number:n,display_name:String(n),app_id:pkg(n),status};
  });
}
const priority=Array.from({length:130},(_,index)=>pkg(index+1));
const lineMap=new Map(priority.map((id,index)=>[id,{lineNumber:index+1}]));

test('端末14相当の実配置からプレモル9件・タコハイ93件を作る',()=>{
  const layout=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  assert.deepEqual(layout.groups.map(group=>group.label),['プレモル','タコハイ']);
  const priority=Array.from({length:130},(_,index)=>pkg(index+1));
  const premol=Core.planCampaign(layout.groups[0],accounts('premol'),priority);
  const taco=Core.planCampaign(layout.groups[1],accounts('taco'),priority);
  assert.equal(premol.loserIds.length,9);
  assert.equal(premol.undrawnIds.length,0);
  assert.equal(premol.placementIds.length,9);
  assert.equal(taco.loserIds.length,93);
  assert.equal(taco.undrawnIds.length,0);
  assert.equal(taco.placementIds.length,93);
  assert.deepEqual(taco.placementIds.slice(0,8),tacoNumbers.map(pkg));
  assert.equal(taco.placementIds[8],pkg(46));
  assert.equal(taco.placementIds.at(-1),pkg(130));
});

test('各ページ7段目のLINEを当選として判定する',()=>{
  const rows=layoutRows();
  rows.push(app(pkg(30),'プレモル',7,1,6,1300));
  const layout=Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6]);
  const premolAccounts=accounts('premol');
  premolAccounts[29].status='loser';
  const priority=Array.from({length:130},(_,index)=>pkg(index+1));
  const plan=Core.planCampaign(layout.groups[0],premolAccounts,priority);
  assert.equal(plan.winnerRowCount,1);
  assert.equal(plan.updates.find(row=>row.account_id.endsWith(pkg(30))).status,'winner');
  assert(!plan.placementIds.includes(pkg(30)));
});

test('7段目のフォルダ内LINEを当選として読む',()=>{
  const rows=layoutRows();
  const premolFolder=folder('プレモル',7,1,6,1350);
  rows.push(
    premolFolder,
    folderApp(pkg(1),'プレモル',premolFolder._id,0,1351),
    folderApp(pkg(2),'プレモル',premolFolder._id,1,1352)
  );
  const layout=Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6]);
  const premol=layout.groups[0];
  assert(!premol.active.some(item=>item.appId===pkg(1)||item.appId===pkg(2)));
  assert(premol.winners.some(item=>item.appId===pkg(1)));
  assert(premol.winners.some(item=>item.appId===pkg(2)));
});

test('1～6段目のフォルダ内LINEを残りとして読む',()=>{
  const rows=layoutRows();
  const premolFolder=folder('プレモル',7,4,5,1370);
  rows.push(premolFolder,folderApp(pkg(1),'プレモル',premolFolder._id,0,1371));
  const layout=Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6]);
  assert(layout.groups[0].active.some(item=>item.appId===pkg(1)));
  assert(!layout.groups[0].winners.some(item=>item.appId===pkg(1)));
});

test('フォルダ内のLINE以外は引き続き拒否する',()=>{
  const rows=layoutRows();
  const premolFolder=folder('プレモル',7,1,6,1360);
  rows.push(premolFolder,folderApp('com.example.other','プレモル',premolFolder._id,0,1361));
  assert.throws(()=>Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6]),/フォルダ内にLINE以外/);
});

test('当選済みLINEが1～6段目へ戻ると停止する',()=>{
  const layout=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const rows=accounts('taco');
  rows[2].status='winner';
  const priority=Array.from({length:130},(_,index)=>pkg(index+1));
  assert.throws(()=>Core.planCampaign(layout.groups[1],rows,priority),/当選済みアカウント/);
});

test('当選履歴のないLINEが追加ページから消えると停止する',()=>{
  const layout=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const rows=accounts('taco');
  const missing=pkg(60);
  layout.groups[1].active=layout.groups[1].active.filter(item=>item.appId!==missing);
  const priority=Array.from({length:130},(_,index)=>pkg(index+1));
  assert.throws(()=>Core.planCampaign(layout.groups[1],rows,priority),/当選履歴のないLINE/);
});

test('終了マーカー欠落・マーカー重複を拒否する',()=>{
  assert.throws(()=>Core.collectMarkerLayout(layoutRows().filter(row=>row.title!=='配置終'),campaigns,[2,3,4,5,6]),/配置終/);
  const duplicated=layoutRows();
  duplicated.push(app(pkg(3),'タコハイボール',8,3,1,1400));
  assert.throws(()=>Core.collectMarkerLayout(duplicated,campaigns,[2,3,4,5,6]),/重複|重な/);
});

test('生成後は配置順・7段目残存まで再検査する',()=>{
  const priority=Array.from({length:130},(_,index)=>pkg(index+1));
  const source=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const plans=[
    Core.planCampaign(source.groups[0],accounts('premol'),priority),
    Core.planCampaign(source.groups[1],accounts('taco'),priority)
  ];
  const generated=[];
  let id=2000;
  let screen=7;
  for(const plan of plans){
    plan.placementIds.forEach((appId,index)=>generated.push(app(appId,plan.label,screen+Math.floor(index/30),index%5,Math.floor((index%30)/5),id++)));
    generated.push(marker(plan.label+'始',screen,id++));
    screen+=Math.max(1,Math.ceil(plan.placementIds.length/30));
  }
  generated.push(marker('配置終',screen,id++));
  const output=Core.collectMarkerLayout(generated,campaigns,[2,3,4,5,6]);
  assert.equal(Core.verifyGeneratedLayout(output,plans),true);
});

test('新規キャンペーンは130アカウントを未着手のまま5ページへ追加する',()=>{
  const source=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const midori={id:'midori',name:'翠ジンソーダ',status:'active',aliases:[],initial_draw_ranges:[]};
  const undrawn=priority.map((id,index)=>({account_id:'14:'+id,device_id:'14',line_number:index+1,display_name:String(index+1),app_id:id,status:'undrawn'}));
  const added=Core.planNewCampaign(midori,source.endMarker,undrawn,priority,5);
  assert.equal(added.fixedPageCount,5);
  assert.equal(added.placementIds.length,130);
  assert.equal(added.undrawnIds.length,130);
  assert.equal(added.updates.length,130);
});

test('新規キャンペーンの5ページ生成結果を再解析して全配置を照合する',()=>{
  const source=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const midori={id:'midori',name:'翠ジンソーダ',status:'active',aliases:[],initial_draw_ranges:[]};
  const undrawn=priority.map((id,index)=>({account_id:'14:'+id,device_id:'14',line_number:index+1,display_name:String(index+1),app_id:id,status:'undrawn'}));
  const plan=Core.planNewCampaign(midori,source.endMarker,undrawn,priority,5);
  const rows=plan.placementIds.map((appId,index)=>app(appId,plan.label,7+Math.floor(index/30),index%5,Math.floor((index%30)/5),6000+index));
  rows.push(marker(plan.label+'始',7,6190),marker('配置終',12,6200));
  const output=Core.collectMarkerLayout(rows,[midori],[2,3,4,5,6]);
  assert.equal(output.groups[0].endScreen,11);
  assert.equal(Core.verifyGeneratedLayout(output,[plan]),true);
});

test('管理画面の並び順を追加ページの順番へ適用する',()=>{
  const source=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const plans=source.groups.map((group,index)=>({label:group.label,campaign:group.campaign,index}));
  const ordered=Core.orderCampaignPlans(plans,[campaigns[1],campaigns[0]]);
  assert.deepEqual(ordered.map(plan=>plan.campaign.id),['taco','premol']);
});

test('新規キャンペーン追加は履歴あり・ページ容量超過を拒否する',()=>{
  const source=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const midori={id:'midori',name:'翠ジンソーダ',status:'active',aliases:[],initial_draw_ranges:[]};
  const undrawn=priority.map((id,index)=>({account_id:'14:'+id,device_id:'14',line_number:index+1,display_name:String(index+1),app_id:id,status:'undrawn'}));
  const decided=undrawn.map(row=>({...row}));decided[0].status='loser';
  assert.throws(()=>Core.planNewCampaign(midori,source.endMarker,decided,priority,5),/既に当落履歴/);
  assert.throws(()=>Core.planNewCampaign(midori,source.endMarker,undrawn,priority,4),/配置できるLINE数を超えています/);
});

test('総ページ数とホーム位置をNova設定へ反映する',()=>{
  const xml='<map>\n<int name="desktop_default_page" value="0" />\n<int name="workspace_screen_count" value="8" />\n</map>';
  const updated=Core.updateNovaXml(xml,11,4);
  assert.match(updated,/desktop_default_page" value="4"/);
  assert.match(updated,/workspace_screen_count" value="11"/);
  assert.throws(()=>Core.updateNovaXml(xml,4,4),/不正/);
});

test('初期化LINEは7段目・当選フォルダ・削除済みから未抽選として1件ずつ自動復帰する',()=>{
  const rows=layoutRows();
  rows.push(app(pkg(30),'古いタイトル',7,1,6,7100));
  const f=folder('プレモル',7,2,6,7101);
  rows.push(f,folderApp(pkg(31),'31',f._id,0,7102));
  const reset=[30,31,32].map(n=>({campaign_id:'premol',account_id:'14:'+pkg(n),app_id:pkg(n),reset_id:'reset-'+n}));
  const layout=Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6],reset);
  const server=accounts('premol').map(row=>({...row,...(reset.find(p=>p.app_id===row.app_id)?{status:'undrawn',reset_id:reset.find(p=>p.app_id===row.app_id).reset_id}:{})}));
  const plan=Core.planCampaign(layout.groups[0],server,priority);
  assert.equal(plan.placementIds.length,12);assert.equal(plan.winnerRowCount,0);
  assert.deepEqual(plan.undrawnIds,[30,31,32].map(pkg));assert.equal(plan.resetPlacements.length,3);
  for(const p of reset)assert.equal(plan.updates.find(u=>u.account_id===p.account_id).status,'undrawn');
  assert.equal(plan.updates.find(u=>u.account_id==='14:'+pkg(33)).status,'winner');
  const unchanged=Core.planCampaign(layout.groups[1],accounts('taco'),priority);
  assert.equal(unchanged.placementIds.length,93);assert.equal(unchanged.resetPlacements.length,0);
  const generated=plan.placementIds.map((id,i)=>app(id,plan.label,7+Math.floor(i/30),i%5,Math.floor(i%30/5),7200+i));
  generated.push(marker(plan.label+'始',7,7290),marker('配置終',8,7291));
  const actual=Core.collectMarkerLayout(generated,[campaigns[0]],[2,3,4,5,6]);
  assert.equal(Core.verifyGeneratedLayout(actual,[plan]),true);
});

test('初期化対象だけ重複配置と旧ラベルを許容し、出力ではタイトルを揃えて1件にする',()=>{
  const rows=layoutRows();rows.push(app(pkg(28),'07',7,1,6,7300));
  const reset=[{campaign_id:'premol',app_id:pkg(28),reset_id:'reset-seven'}];
  const layout=Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6],reset);
  const server=accounts('premol');Object.assign(server[27],{status:'undrawn',reset_id:'reset-seven'});
  const plan=Core.planCampaign(layout.groups[0],server,priority);
  assert.equal(plan.placementIds.filter(id=>id===pkg(28)).length,1);
  assert.equal(plan.loserIds.length,8);assert.deepEqual(plan.undrawnIds,[pkg(28)]);
  assert.throws(()=>Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6]),/別ラベル|重複/);
  assert.throws(()=>Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6],[{...reset[0],campaign_id:'taco'}]),/別ラベル|重複/);
});

test('復帰後の次回抽選では通常の7段目判定に戻り、再度自動復帰しない',()=>{
  const server=accounts('premol');server[29].status='undrawn';
  const rows=layoutRows();rows.push(app(pkg(30),'プレモル',7,1,6,7400));
  const layout=Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6]);
  const plan=Core.planCampaign(layout.groups[0],server,priority);
  assert.equal(plan.updates.find(u=>u.account_id==='14:'+pkg(30)).status,'winner');
  assert(!plan.placementIds.includes(pkg(30)));assert.equal(plan.resetPlacements.length,0);
});

test('復帰待ちでも当落が変更された場合と固定初期データにないLINEは停止する',()=>{
  const layout=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const server=accounts('premol');server[29].reset_id='reset';
  assert.throws(()=>Core.planCampaign(layout.groups[0],server,priority),/配置待ちLINEの当落/);
  server.push({account_id:'14:unknown',app_id:'unknown',line_number:151,status:'undrawn',reset_id:'reset'});
  assert.throws(()=>Core.planCampaign(layout.groups[0],server,priority),/固定初期データ/);
});
