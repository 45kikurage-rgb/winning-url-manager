const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../home-layout-marker-core.js');

const markerIntent='#Intent;component=org.chromium.webapk.marker/org.chromium.webapk.Main;end';
const flag=(title,screen,id)=>({_id:id,title,intent:markerIntent,container:-100,screen,cellX:0,cellY:6,itemType:0});

test('ページフラグ名はPage01からゼロ埋めの通し番号にする',()=>{
  assert.equal(Core.pageFlagTitle(1),'Page01');
  assert.equal(Core.pageFlagTitle(9),'Page09');
  assert.equal(Core.pageFlagTitle(10),'Page10');
  assert.equal(Core.pageFlagNumber('Page01'),1);
  assert.equal(Core.pageFlagNumber('page12'),12);
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

test('全ページの正しいフラグを確認できる',()=>{
  const screens=[2,3,4,5,6,7,8];
  const rows=screens.map((screen,index)=>flag(Core.pageFlagTitle(index+1),screen,100+index));
  const inspected=Core.inspectPageFlags(rows,screens);
  assert.equal(inspected.legacy,false);
  assert.deepEqual(inspected.warnings,[]);
  assert.equal(Core.verifyPageFlags(rows,screens),true);
});

test('旧形式・欠番・重複・順番違いを警告する',()=>{
  const legacy=Core.inspectPageFlags([flag('配置終',8,1)],[2,3,4]);
  assert.equal(legacy.legacy,true);
  assert.match(legacy.warnings.join('\n'),/旧形式/);

  const rows=[flag('Page01',2,10),flag('Page01',3,11),flag('Page03',3,12)];
  const inspected=Core.inspectPageFlags(rows,[2,3,4]);
  assert.match(inspected.warnings.join('\n'),/Page02がありません|Page02の位置/);
  assert.match(inspected.warnings.join('\n'),/Page01が2個/);
  assert.match(inspected.warnings.join('\n'),/Page03がありません/);
  assert.throws(()=>Core.verifyPageFlags(rows,[2,3,4]),/ページフラグ/);
});

test('生成処理はキャンペーン名フラグと配置終を作らず全ページをPage化する',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','home-layout-edit.html'),'utf8');
  assert.match(html,/MarkerCore\.pageFlagTitle\(index\+1\)/);
  assert.match(html,/generatedPageScreens=\[\.\.\.defaultScreens,\.\.\.additionalScreens\]/);
  assert.match(html,/MarkerCore\.verifyPageFlags\(generatedRows,generatedPageScreens\)/);
  assert.match(html,/const pageCount=MarkerCore\.pageCountForItems\(ids\.length\)/);
  assert.match(html,/if\(pageCount\)/);
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
