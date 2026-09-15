const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../home-layout-marker-core.js');

const html=fs.readFileSync(path.join(__dirname,'..','home-layout-edit.html'),'utf8');

test('マーカー照合には終了済みを含む全キャンペーンを使用する',()=>{
  assert.match(html,/allServerCampaigns=response\.campaigns\|\|\[\]/);
  assert.match(html,/collectMarkerLayout\(afterRows,allServerCampaigns,/);
});

test('再配置と履歴更新は表示中キャンペーンだけに限定する',()=>{
  assert.match(html,/activeMarkerGroups=markerLayout\.groups\.filter\(group=>group\.campaign\.status==='active'\)/);
  assert.match(html,/const preparedGroups=activeMarkerGroups/);
});

test('終了済みキャンペーンを削除対象として確認画面へ表示する',()=>{
  assert.match(html,/終了済み・追加ページから削除/);
  assert.match(html,/再配置しない/);
  assert.match(html,/archivedCampaigns:\(analysis\.archivedGroups\|\|\[\]\)/);
});

test('終了済みだけの整理では空の当落更新APIを呼ばない',()=>{
  assert.match(html,/if\(record\.commitBody\.batches\.length\)/);
  assert.match(html,/終了済みページ削除済み/);
});

test('終了済みの開始マーカーも解析し、表示中だけを再配置対象にできる',()=>{
  const markerIntent='#Intent;component=org.chromium.webapk.marker/org.chromium.webapk.Main;end';
  const lineIntent=id=>'#Intent;component='+id+'/.activity.SplashActivity;end';
  const marker=(title,screen,id)=>({_id:id,title,intent:markerIntent,container:-100,screen,cellX:0,cellY:6,itemType:0});
  const line=(title,screen,id)=>({_id:id,title,intent:lineIntent('jp.naver.line.test'+id),container:-100,screen,cellX:0,cellY:0,itemType:0});
  const campaigns=[
    {id:'premol',name:'プレモル',status:'archived',aliases:[]},
    {id:'yakan',name:'やかんの麦茶',status:'active',aliases:[]}
  ];
  const rows=[
    line('プレモル',5,101),marker('プレモル始',5,102),
    line('やかんの麦茶',6,201),marker('やかんの麦茶始',6,202),
    marker('配置終',7,301)
  ];
  const layout=Core.collectMarkerLayout(rows,campaigns,[0,1,2,3,4]);
  assert.deepEqual(layout.groups.map(group=>[group.label,group.campaign.status]),[
    ['プレモル','archived'],['やかんの麦茶','active']
  ]);
  assert.deepEqual(layout.groups.filter(group=>group.campaign.status==='active').map(group=>group.label),['やかんの麦茶']);
});
