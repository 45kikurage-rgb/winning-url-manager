const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

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
