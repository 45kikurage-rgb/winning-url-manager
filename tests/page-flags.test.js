const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../home-layout-marker-core.js');

const markerIntent='#Intent;component=org.chromium.webapk.marker/org.chromium.webapk.Main;end';
const flag=(title,screen,id)=>({_id:id,title,intent:markerIntent,container:-100,screen,cellX:0,cellY:6,itemType:0});

test('ページフラグ名はページ群と群内ページの二段階番号にする',()=>{
  assert.equal(Core.pageFlagTitle(0,1),'Page00-01');
  assert.equal(Core.pageFlagTitle(1,1),'Page01-01');
  assert.equal(Core.pageFlagTitle(1,9),'Page01-09');
  assert.equal(Core.pageFlagTitle(2,10),'Page02-10');
  assert.deepEqual(Core.pageFlagParts('Page00-01'),{group:0,page:1});
  assert.equal(Core.pageFlagGroupNumber('page12-03'),12);
  assert.equal(Core.pageFlagNumber('page12-03'),3);
  assert.equal(Core.pageFlagNumber('Page01'),null);
  assert.equal(Core.pageFlagNumber('プレモル'),null);
});

test('非当選件数に合わせて追加ページ数を0～5ページに縮める',()=>{
  assert.equal(Core.pageCountForItems(0),0);
  assert.equal(Core.pageCountForItems(1),1);
  assert.equal(Core.pageCountForItems(30),1);
  assert.equal(Core.pageCountForItems(31),2);
  assert.equal(Core.pageCountForItems(60),2);
  assert.equal(Core.pageCountForItems(61),3);
  assert.equal(Core.pageCountForItems(90),3);
  assert.equal(Core.pageCountForItems(91),4);
  assert.equal(Core.pageCountForItems(120),4);
  assert.equal(Core.pageCountForItems(121),5);
  assert.equal(Core.pageCountForItems(150),5);
});

test('アプリがない追加ページ群は作らず、後続のPage番号を詰める',()=>{
  assert.deepEqual(Core.buildPageFlagGroups([4,0,2,1,3],[[],[5,6],[],[7]]),[
    {group:0,screens:[0,1,2,3,4]},
    {group:1,screens:[5,6]},
    {group:2,screens:[7]}
  ]);
});

test('全ページの正しいフラグを確認できる',()=>{
  const screens=[2,3,4,5,6,7,8];
  const groups=[{group:0,screens:screens.slice(0,5)},{group:1,screens:screens.slice(5)}];
  const rows=[
    ...groups[0].screens.map((screen,index)=>flag(Core.pageFlagTitle(0,index+1),screen,100+index)),
    ...groups[1].screens.map((screen,index)=>flag(Core.pageFlagTitle(1,index+1),screen,200+index))
  ];
  const inspected=Core.inspectPageFlags(rows,groups);
  assert.equal(inspected.legacy,false);
  assert.deepEqual(inspected.warnings,[]);
  assert.equal(Core.verifyPageFlags(rows,groups),true);
});

test('旧形式・欠番・重複・順番違いを警告する',()=>{
  const groups=[{group:0,screens:[2,3]},{group:1,screens:[4]}];
  const legacy=Core.inspectPageFlags([flag('Page01',8,1)],groups);
  assert.equal(legacy.legacy,true);
  assert.match(legacy.warnings.join('\n'),/旧形式/);

  const rows=[flag('Page00-01',2,10),flag('Page00-01',3,11),flag('Page01-02',4,12)];
  const inspected=Core.inspectPageFlags(rows,groups);
  assert.match(inspected.warnings.join('\n'),/Page00-02がありません|Page00-02の位置/);
  assert.match(inspected.warnings.join('\n'),/Page00-01が2個/);
  assert.match(inspected.warnings.join('\n'),/Page01-01の位置/);
  assert.throws(()=>Core.verifyPageFlags(rows,groups),/ページフラグ/);
});

test('生成処理はデフォルトと追加ページ群ごとにPage番号を付ける',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','home-layout-edit.html'),'utf8');
  assert.match(html,/MarkerCore\.buildPageFlagGroups\(defaultScreens,pages\.map/);
  assert.match(html,/MarkerCore\.pageFlagTitle\(group\.group,index\+1\)/);
  assert.match(html,/MarkerCore\.verifyPageFlags\(generatedRows,generatedPageFlagGroups\)/);
  assert.match(html,/const pageCount=MarkerCore\.pageCountForItems\(ids\.length\)/);
  assert.match(html,/if\(pageCount\)/);
  assert.match(html,/MarkerCore\.isPageFlagTitle\(row\.title\)/);
  assert.match(html,/replaceableFlags=occupied\.filter\(row=>MarkerCore\.isPageFlagTitle\(row\.title\)\)/);
  assert.match(html,/const blockers=occupied\.filter\(row=>!MarkerCore\.isPageFlagTitle\(row\.title\)\)/);
  assert.ok(html.indexOf('replaceableFlags=occupied.filter')<html.indexOf("if(blockers.length)throw new Error(flagTitle+\'を置く左下に別の項目があります。"));
  assert.doesNotMatch(html,/Math\.max\(Number\(plan\.fixedPageCount/);
  assert.doesNotMatch(html,/insertCopy\(db,columns,plan\.marker,nextId\+\+,plan\.label,startScreen,0,6\)/);
  assert.match(html,/endMarker:false/);
});

test('非当選0件のキャンペーンは生成後の追加ページ検査対象から除外する',()=>{
  const emptyPlan={label:'全当選',campaign:{id:'done'},placementIds:[]};
  assert.equal(Core.verifyGeneratedLayout({groups:[]},[emptyPlan]),true);
});

test('キャンペーン名のないPageフラグだけになっても全当選キャンペーンを新規扱いしない',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','home-layout-edit.html'),'utf8');
  assert.match(html,/unseenCampaigns\.forEach/);
  assert.match(html,/rows\.every\(row=>String\(row\.status\|\|'undrawn'\)==='winner'\)/);
  assert.match(html,/completedCampaigns\.push\(campaign\)/);
  assert.match(html,/全当選・追加ページ不要/);
  assert.match(html,/当選済みでないLINEが残っているため、データ消失防止のため停止/);
});
