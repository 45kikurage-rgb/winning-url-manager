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

function spatialApps(numbers,title,screen,startId){
  return numbers.map((n,index)=>app(pkg(n),title,screen,index%5,Math.floor(index/5),startId+index));
}
function layoutRows(){
  return [
    ...spatialApps(premolNumbers,'プレモル',7,1000),
    marker('プレモル始',7,1090),
    ...spatialApps(tacoNumbers,'タコハイボール',8,1100),
    marker('タコハイ始',8,1190),
    marker('配置終',9,1200)
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
  assert.equal(taco.loserIds.length,8);
  assert.equal(taco.undrawnIds.length,85);
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

test('7段目のフォルダ内LINEを未当選として読む',()=>{
  const rows=layoutRows();
  const premolFolder=folder('プレモル',7,1,6,1350);
  rows.push(
    premolFolder,
    folderApp(pkg(1),'プレモル',premolFolder._id,0,1351),
    folderApp(pkg(2),'プレモル',premolFolder._id,1,1352)
  );
  const layout=Core.collectMarkerLayout(rows,campaigns,[2,3,4,5,6]);
  const premol=layout.groups[0];
  assert(premol.active.some(item=>item.appId===pkg(1)));
  assert(premol.active.some(item=>item.appId===pkg(2)));
  assert(!premol.winners.some(item=>item.appId===pkg(1)||item.appId===pkg(2)));
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

test('抽選済み範囲外にサーバー結果があると停止する',()=>{
  const layout=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const rows=accounts('taco');
  rows[59].status='loser';
  const priority=Array.from({length:130},(_,index)=>pkg(index+1));
  assert.throws(()=>Core.planCampaign(layout.groups[1],rows,priority),/抽選済み範囲に含まれていません/);
});

test('終了マーカー欠落・マーカー重複を拒否する',()=>{
  assert.throws(()=>Core.collectMarkerLayout(layoutRows().filter(row=>row.title!=='配置終'),campaigns,[2,3,4,5,6]),/配置終/);
  const duplicated=layoutRows();
  duplicated.push(app(pkg(3),'タコハイボール',8,3,1,1400));
  assert.throws(()=>Core.collectMarkerLayout(duplicated,campaigns,[2,3,4,5,6]),/重複/);
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
  assert.deepEqual(added.updates,[]);
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

test('新規キャンペーン追加は履歴あり・120件以下を拒否する',()=>{
  const source=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const midori={id:'midori',name:'翠ジンソーダ',status:'active',aliases:[],initial_draw_ranges:[]};
  const undrawn=priority.map((id,index)=>({account_id:'14:'+id,device_id:'14',line_number:index+1,display_name:String(index+1),app_id:id,status:'undrawn'}));
  const decided=undrawn.map(row=>({...row}));decided[0].status='loser';
  assert.throws(()=>Core.planNewCampaign(midori,source.endMarker,decided,priority,5),/既に当落履歴/);
  assert.throws(()=>Core.planNewCampaign(midori,source.endMarker,undrawn.slice(0,120),priority.slice(0,120),5),/121～150件/);
});

test('未抽選キャンペーンは範囲未登録でも完全な5ページ配置だけ維持する',()=>{
  const source=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const group={...source.groups[0],campaign:{...source.groups[0].campaign,name:'翠ジンソーダ',initial_draw_ranges:[]},label:'翠ジンソーダ'};
  group.active=priority.map((appId,index)=>({appId,row:{_id:index+1}}));
  group.winners=[];
  const undrawn=priority.map((id,index)=>({account_id:'14:'+id,device_id:'14',line_number:index+1,display_name:String(index+1),app_id:id,status:'undrawn'}));
  const plan=Core.planUnstartedCampaign(group,undrawn,priority,5);
  assert.equal(plan.isUnstartedCampaign,true);
  assert.equal(plan.placementIds.length,130);
  assert.deepEqual(plan.updates,[]);
});

test('未抽選キャンペーンは配置欠け・7段目・履歴ありを拒否する',()=>{
  const source=Core.collectMarkerLayout(layoutRows(),campaigns,[2,3,4,5,6]);
  const group={...source.groups[0],campaign:{...source.groups[0].campaign,name:'翠ジンソーダ',initial_draw_ranges:[]},label:'翠ジンソーダ'};
  group.active=priority.map((appId,index)=>({appId,row:{_id:index+1}}));
  group.winners=[];
  const undrawn=priority.map((id,index)=>({account_id:'14:'+id,device_id:'14',line_number:index+1,display_name:String(index+1),app_id:id,status:'undrawn'}));
  assert.throws(()=>Core.planUnstartedCampaign({...group,active:group.active.slice(1)},undrawn,priority,5),/初期配置と一致しません/);
  assert.throws(()=>Core.planUnstartedCampaign({...group,winners:[group.active.at(-1)]},undrawn,priority,5),/7段目/);
  assert.throws(()=>Core.planUnstartedCampaign(group,undrawn.map((row,index)=>index?row:{...row,status:'winner'}),priority,5),/既に当落履歴/);
});

test('総ページ数とホーム位置をNova設定へ反映する',()=>{
  const xml='<map>\n<int name="desktop_default_page" value="0" />\n<int name="workspace_screen_count" value="8" />\n</map>';
  const updated=Core.updateNovaXml(xml,11,4);
  assert.match(updated,/desktop_default_page" value="4"/);
  assert.match(updated,/workspace_screen_count" value="11"/);
  assert.throws(()=>Core.updateNovaXml(xml,4,4),/不正/);
});

test('初回設定は6ページのプレモルと7ページのタコハイを実データとして読む',()=>{
  const rows=[
    urlSource(),
    ...spatialApps(premolNumbers,'プレモル',7,3000),
    ...spatialApps(tacoNumbers,'タコハイボール',8,3100)
  ];
  const layout=Core.collectBootstrapLayout(rows,campaigns,[2,3,4,5,6],lineMap);
  assert.equal(layout.mode,'bootstrap');
  assert.deepEqual(layout.groups.map(group=>group.label),['プレモル','タコハイ']);
  const premol=Core.planCampaign(layout.groups[0],accounts('premol'),priority);
  const taco=Core.planCampaign(layout.groups[1],accounts('taco'),priority);
  assert.equal(premol.placementIds.length,9);
  assert.equal(taco.loserIds.length,8);
  assert.equal(taco.undrawnIds.length,85);
  assert.equal(taco.placementIds.length,93);
});

test('6ページの複数フォルダから30件超のプレモル未当選を読む',()=>{
  const first=folder('プレモル',7,0,0,4000);
  const second=folder('プレモル',7,1,0,4001);
  const premol35=Array.from({length:35},(_,index)=>index+1);
  const rows=[
    urlSource(),first,second,
    ...premol35.slice(0,20).map((n,index)=>folderApp(pkg(n),'プレモル',first._id,index,4100+index)),
    ...premol35.slice(20).map((n,index)=>folderApp(pkg(n),'プレモル',second._id,index,4200+index)),
    ...spatialApps(tacoNumbers,'タコハイボール',8,4300)
  ];
  const layout=Core.collectBootstrapLayout(rows,campaigns,[2,3,4,5,6],lineMap);
  assert.equal(layout.groups[0].active.length,35);
  assert.deepEqual(new Set(layout.groups[0].active.map(item=>item.appId)),new Set(premol35.map(pkg)));
  const activeSet=new Set(premol35);
  const premolAccounts=priority.map((id,index)=>({account_id:'14:'+id,device_id:'14',line_number:index+1,display_name:String(index+1),app_id:id,status:activeSet.has(index+1)?'loser':'winner'}));
  const plan=Core.planCampaign(layout.groups[0],premolAccounts,priority);
  assert.equal(plan.placementIds.length,35);
  assert.equal(Math.ceil(plan.placementIds.length/30),2);
});

test('初回設定はタコハイ46以降の配置とURL送信アプリ欠落を拒否する',()=>{
  const rows=[urlSource(),...spatialApps(premolNumbers,'プレモル',7,5000),...spatialApps([...tacoNumbers,46],'タコハイボール',8,5100)];
  assert.throws(()=>Core.collectBootstrapLayout(rows,campaigns,[2,3,4,5,6],lineMap),/未着手範囲のLINE46/);
  assert.throws(()=>Core.collectBootstrapLayout(rows.filter(row=>row.title!=='URL送信'),campaigns,[2,3,4,5,6],lineMap),/URL送信/);
});
