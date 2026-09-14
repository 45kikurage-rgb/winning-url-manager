const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync(require.resolve('../layout-account-reset-ui.js'),'utf8');

class Element {
  constructor(tag='div'){this.tag=tag;this.value='';this.hidden=false;this.disabled=false;this.attrs={};this.children=[];this._html='';}
  set innerHTML(value){
    this._html=value;
    if(this.tag==='select'){
      const options=[...value.matchAll(/<option value="([^"]*)"/g)].map(m=>m[1]);
      this.value=options[0]||'';
    }
    this.children=[...value.matchAll(/<input type="checkbox" value="([^"]*)"([^>]*)>/g)].map(m=>({value:m[1],checked:/\bchecked\b/.test(m[2]),disabled:false}));
  }
  get innerHTML(){return this._html;}
  querySelectorAll(selector){return selector==='input:checked'?this.children.filter(x=>x.checked):this.children;}
  setAttribute(key,value){this.attrs[key]=value;}
  focus(){this.focused=true;}
}
function fixture({storage=new Map(),server={calls:[],fail:null,saved:null}}={}){
  const ids=['correctTab','resetTab','correctPane','resetPane','resetPending','resetCampaigns','resetSelectAll','resetSave','resetHistory'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  elements.resetDevice=new Element('select');elements.resetLine=new Element('select');
  const data={campaigns:[{id:'a',name:'プレモル',status:'active'},{id:'b',name:'タコハイ',status:'active'},{id:'end',name:'終了',status:'archived'}],
    accounts:[{id:'01:1',device_id:'01',line_number:1,is_active:1},{id:'03:15',device_id:'03',line_number:15,is_active:1},{id:'03:old',device_id:'03',line_number:16,is_active:0}],history:[]};
  let message='',confirmed=true,confirmMessage='',refreshCount=0;
  const summary={ok:true,device:'03',account_id:'03:15',line_number:15,campaign_count:2,change_count:2,preserved_winner_count:1,
    preview_token:'a'.repeat(64),targets:[{campaign_id:'a',name:'プレモル',old_status:'winner',changed:true},{campaign_id:'b',name:'タコハイ',old_status:'loser',changed:true}]};
  const context={window:{},crypto:{randomUUID},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    confirm:message=>{confirmMessage=message;return confirmed;}};
  vm.runInNewContext(source,context);
  const api=context.window.LayoutAccountReset.create({$:id=>elements[id],esc:String,getData:()=>data,status:text=>message=text,
    statusName:value=>({winner:'当選',loser:'外れ',undrawn:'未抽選'})[value],refresh:async()=>{refreshCount++},
    call:async(path,{body})=>{
      const input=JSON.parse(body);server.calls.push({path,input});
      if(path.endsWith('/preview'))return summary;
      if(server.fail==='stale'){const error=new Error('確認後に変更されました');error.status=409;throw error;}
      if(!server.saved)server.saved={...summary,request_id:input.request_id};
      if(server.fail==='lost'){server.fail=null;throw new Error('通信切断');}
      return server.saved;
    }});
  api.render();
  const select=()=>{elements.resetDevice.value='03';elements.resetDevice.onchange();elements.resetLine.value='03:15';elements.resetSelectAll.onclick();};
  return {elements,api,data,storage,server,select,summary,setConfirm:value=>confirmed=value,
    get message(){return message},get confirmMessage(){return confirmMessage},get refreshCount(){return refreshCount}};
}

test('切替タブ・開催中一括選択・端末別LINE選択を操作できる',()=>{
  const f=fixture(),e=f.elements;
  assert.equal(e.resetDevice.value,'');assert.equal(e.resetLine.disabled,true);
  e.resetTab.onclick();assert.equal(e.correctPane.hidden,true);assert.equal(e.resetPane.hidden,false);assert.equal(e.resetTab.attrs['aria-selected'],'true');
  e.resetTab.onkeydown({key:'ArrowLeft',preventDefault(){}});assert.equal(e.correctPane.hidden,false);assert.equal(e.correctTab.focused,true);
  f.select();assert.match(e.resetLine.innerHTML,/LINE 15/);assert.doesNotMatch(e.resetLine.innerHTML,/LINE 16/);
  assert.equal(e.resetCampaigns.children.length,2);assert.ok(e.resetCampaigns.children.every(x=>x.checked));
  e.resetSelectAll.onclick();assert.ok(e.resetCampaigns.children.every(x=>!x.checked));
});

test('対象未選択は送信せず、確認キャンセルは当落を変更しない',async()=>{
  const f=fixture();await f.elements.resetSave.onclick();assert.equal(f.server.calls.length,0);
  f.select();f.setConfirm(false);await f.elements.resetSave.onclick();
  assert.equal(f.server.calls.length,1);assert.ok(f.server.calls[0].path.endsWith('/preview'));assert.equal(f.storage.size,0);
  assert.match(f.confirmMessage,/端末03／LINE15/);assert.match(f.confirmMessage,/当選 → 未抽選/);assert.match(f.confirmMessage,/対象2キャンペーン/);
  assert.equal(f.elements.resetSave.disabled,false);
});

test('確認した対象だけを保存し、統計を再取得して初期化結果を表示する',async()=>{
  const f=fixture();f.select();await f.elements.resetSave.onclick();
  const body=f.server.calls[1].input;
  assert.deepEqual(body.campaign_ids,['a','b']);assert.equal(body.account_id,'03:15');assert.equal(body.confirm_reset,true);
  assert.equal(f.refreshCount,1);assert.equal(f.storage.size,0);assert.match(f.message,/入れ替え前の当選1件を保存/);
});

test('応答を失って画面を開き直しても同じ操作番号で結果確認し、二重初期化を防ぐ',async()=>{
  const f=fixture();f.select();f.server.fail='lost';await f.elements.resetSave.onclick();
  assert.equal(f.storage.size,1);assert.equal(f.elements.resetDevice.disabled,true);
  const first=f.server.calls[1].input;
  const next=fixture({storage:f.storage,server:f.server});assert.match(next.elements.resetSave.textContent,/前回/);
  await next.elements.resetSave.onclick();
  assert.deepEqual(f.server.calls[2].input,first);assert.equal(f.server.calls.filter(x=>x.path.endsWith('/preview')).length,1);
  assert.equal(f.storage.size,0);assert.equal(next.elements.resetDevice.disabled,false);
});

test('確認後の競合では再確認できる状態に戻し、初期化履歴を表示する',async()=>{
  const f=fixture();f.select();f.server.fail='stale';await f.elements.resetSave.onclick();
  assert.equal(f.storage.size,0);assert.equal(f.elements.resetDevice.disabled,false);assert.match(f.message,/確認後に変更/);
  f.data.history=[{source:'account-reset',campaign_name:'プレモル',device_id:'03',line_number:15,old_status:'winner',changed_at:'2026-09-14'},
    {source:'row7',campaign_name:'表示しない',device_id:'01',line_number:1,old_status:'loser'}];
  f.api.render();assert.match(f.elements.resetHistory.innerHTML,/プレモル／端末03／LINE15/);assert.doesNotMatch(f.elements.resetHistory.innerHTML,/表示しない/);
});
