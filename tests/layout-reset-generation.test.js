const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {webcrypto}=require('node:crypto');
const Core=require('../home-layout-marker-core.js');
const html=fs.readFileSync(require.resolve('../home-layout-edit.html'),'utf8');
const extract=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));

function fixture(includeNew=false){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE favorites(_id INTEGER PRIMARY KEY,title TEXT,intent TEXT,container INTEGER,screen INTEGER,cellX INTEGER,cellY INTEGER,itemType INTEGER,rank INTEGER,modified INTEGER,novaFlags INTEGER)');
  const line=n=>'jp.naver.line.test'+n;
  const app=(n,title,screen,x,y,id,container=-100)=>({_id:id,title,intent:'#Intent;component='+line(n)+'/.Main;end',container,screen,cellX:x,cellY:y,itemType:0});
  const marker=(title,screen,id)=>({_id:id,title,intent:'#Intent;component=org.chromium.webapk.marker/.Main;end',container:-100,screen,cellX:0,cellY:6,itemType:0});
  const base=[1,2,3,4,5].map(n=>app(n,String(n),n-1,0,0,n));
  if(includeNew)base.push(app(6,'06',4,1,0,6));
  const after=[...base,marker('プレモル始',5,10),app(1,'古い名前',5,1,6,11),app(2,'プレモル',5,0,0,12),marker('配置終',6,13)];
  for(const row of after)sqlite.prepare('INSERT INTO favorites('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
  const db={run:sql=>sqlite.exec(sql),prepare:sql=>({run:args=>sqlite.prepare(sql).run(...args),free(){}}),export:()=>new Uint8Array([1,2]),close(){}};
  const campaign={id:'a',name:'プレモル',status:'active'};
  const accounts=base.map((row,i)=>({account_id:'01:'+line(i+1),app_id:line(i+1),line_number:i+1,status:i===0?'undrawn':i===1?'loser':'winner',reset_id:i===0?'reset-one':''}));
  if(includeNew)Object.assign(accounts[5],{status:'undrawn',reset_id:'new-line:a:01:'+line(6)});
  const resets=[{campaign_id:'a',app_id:line(1),reset_id:'reset-one'}];
  const layout=Core.collectMarkerLayout(after,[campaign],[0,1,2,3,4],resets);
  const plan=Core.planCampaign(layout.groups[0],accounts,base.map((r,i)=>line(i+1)));
  const nodes=new Map(),records=new Map(),requests=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='device'?'01':'',textContent:'',disabled:false});return nodes.get(id)};
  let fail=false,failPut=false;
  const context={console,crypto:webcrypto,Blob,Uint8Array,Date,Map,Set,JSON,Math,Number,String,Error,
    $,query:(_,sql)=>sqlite.prepare(sql).all(),MarkerCore:Core,serverCampaigns:[campaign],
    packageId:Core.packageId,isLine:Core.isLine,isCampaignLayoutWork:()=>true,
    put:async record=>{if(failPut)throw Error('disk unavailable');records.set(record.id,structuredClone(record))},getAll:async()=>[...records.values()],deleteRecords:async ids=>ids.forEach(id=>records.delete(id)),
    apiCall:async(path,options)=>{const body=JSON.parse(options.body);requests.push({path,body});if(fail)throw Error('connection lost');return {ok:true,batches:body.batches?.map(b=>({campaign_id:b.campaign_id,submitted_count:b.updates.length}))||[]}},
    setWorkflowStep(){},showStatus(el,message){el.textContent=message},timestamp:()=> '20260914',safeName:x=>x,saveLogs(){},renderCampaigns(){},renderCampaignSelect(){},
    analysis:{workingDb:db,workingZip:{file(){},generateAsync:async()=>new Blob(['NOVA'])},afterRows:after,byPackage:new Map(base.map((r,i)=>[line(i+1),r])),
      maxScreen:4,defaultPageCount:5,workTarget:'marker',markerPlans:[plan],markerLayout:layout,
      campaign:'プレモル',campaignId:'a',projectedLogs:{order:['プレモル'],campaigns:{}},allLogs:{},base:{fileName:'base'},after:{fileName:'after'},
      sourceHash:'a'.repeat(64),placementToken:'token',pendingPreviews:[{campaign,updates:plan.updates,plan,preview:{}}]},output:null,
    updateNovaPreferences:async()=>{},validateCommitResponse:()=>true
  };
  vm.createContext(context);
  vm.runInContext(extract('function insertCopy(', 'async function updateNovaPreferences(')+
    extract('function verifyDefaultLayout(', 'function download(')+
    extract('function showStoredPlacement(', 'async function init(){'),context);
  return {context,sqlite,$,records,requests,line,setFail:value=>{fail=value},setFailPut:value=>{failPut=value}};
}

test('生成SQLで旧当選配置を整理し、キャンペーン名の未抽選アイコンを1件だけ復帰。固定ページを維持する',async()=>{
  const f=fixture();await f.context.generate();
  assert.ok(f.context.output,f.$('generateStatus').textContent);
  const rows=f.sqlite.prepare('SELECT * FROM favorites WHERE container=-100 AND screen=5 AND itemType=0').all();
  const restored=rows.filter(r=>Core.packageId(r.intent)===f.line(1));
  assert.equal(restored.length,1);assert.equal(restored[0].title,'プレモル');assert.ok(restored[0].cellY<6);
  const request=f.requests.find(r=>r.path==='/api/layout/results/batch').body;
  assert.equal(request.batches[0].reset_placements[0].reset_id,'reset-one');
  assert.equal(request.batches[0].updates[0].status,'undrawn');
  assert.equal(f.records.size,1);assert.equal([...f.records.values()][0].kind,'generated');
});

test('送信前のファイル保存失敗ではサーバーに当落を送信しない',async()=>{
  const f=fixture();f.setFailPut(true);await f.context.generate();
  assert.equal(f.requests.length,0);assert.equal(f.context.output,null);
});

test('通信断で作成ファイルと同じ送信番号を保持し、再読込相当の復旧で再送・保存できる',async()=>{
  const f=fixture();f.setFail(true);await f.context.generate();
  assert.equal(f.context.output,null);assert.equal(f.$('generate').disabled,false);
  const pending=[...f.records.values()][0];assert.equal(pending.kind,'pending-generated');
  const first=JSON.stringify(f.requests[0].body);
  f.setFail(false);assert.equal(await f.context.recoverPendingPlacement(),true);
  assert.equal(JSON.stringify(f.requests[1].body),first);
  assert.equal(f.context.output.id,pending.id);assert.equal(f.$('saveOutput').disabled,false);
});

test('デフォルトに増やした新規LINEと初期化LINEを同時に追加ページへ配置し、タイトルと未抽選を設定する',async()=>{
  const f=fixture(true);await f.context.generate();
  assert.ok(f.context.output,f.$('generateStatus').textContent);
  const rows=f.sqlite.prepare('SELECT * FROM favorites WHERE container=-100').all();
  for(const n of [1,6]){
    const extra=rows.filter(r=>r.screen===5&&Core.packageId(r.intent)===f.line(n));
    assert.equal(extra.length,1);assert.equal(extra[0].title,'プレモル');assert.ok(extra[0].cellY<6);
  }
  const defaults=rows.filter(r=>r.screen===4&&Core.packageId(r.intent)===f.line(6));
  assert.equal(defaults.length,1);assert.equal(defaults[0].title,'06');
  const body=f.requests.find(r=>r.path==='/api/layout/results/batch').body;
  assert.equal(body.batches[0].updates.find(u=>u.account_id==='01:'+f.line(6)).status,'undrawn');
  assert.equal(body.batches[0].reset_placements.length,2);
});

test('配置解析ではアカウント同期後に配置待ちを読み込み、新規追加を同じ解析へ反映する',()=>{
  const analyze=extract('async function analyze(){','function insertCopy(');
  assert(analyze.indexOf("apiCall('/api/layout/accounts/sync'")<analyze.indexOf("apiCall('/api/layout/reset-placements?"));
  assert(analyze.indexOf("apiCall('/api/layout/reset-placements?")<analyze.indexOf('MarkerCore.collectTitleLayout('));
  assert.match(html,/新規LINEの自動追加/);
});
