const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../home-layout-marker-core.js');

const markerIntent='#Intent;component;component=org.chromium.webapk.marker/org.chromium.webapk.Main;end';
const lineIntent=id=>'#Intent;component='+id+'/.activity.SplashActivity;end';
const pkg=n=>'jp.naver.line.test'+String(n).padStart(3,'0');
const app=(id,title,screen,x,y,_id)=>({_id,title,intent:lineIntent(id),container:-100,screen,cellX:x,cellY:y,itemType:0});
const marker=(title,screen,_id)=>({_id,title,intent:markerIntent,container:-100,screen,cellX:0,cellY:6,itemType:0});

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

test('総ページ数とホーム位置をNova設定へ反映する',()=>{
  const xml='<map>\n<int name="desktop_default_page" value="0" />\n<int name="workspace_screen_count" value="8" />\n</map>';
  const updated=Core.updateNovaXml(xml,11,4);
  assert.match(updated,/desktop_default_page" value="4"/);
  assert.match(updated,/workspace_screen_count" value="11"/);
  assert.throws(()=>Core.updateNovaXml(xml,4,4),/不正/);
});
