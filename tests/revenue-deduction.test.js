const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname,'../revenue-deduction.js'),'utf8');

function fixture(storage = new Map(), call = async () => {}, getHistory = async () => ({ok:true,deductions:[],next_cursor:null})) {
  const elements = new Map();
  const timers = new Map();
  let timerId = 0;
  const doc = {activeElement:null,listeners:{},addEventListener(type,fn){this.listeners[type]=fn}};
  const win = {listeners:{},addEventListener(type,fn){this.listeners[type]=fn}};
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id,{
        value:'',textContent:'',listeners:{},attributes:{},
        classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},
        addEventListener(type,fn){this.listeners[type]=fn},
        setAttribute(k,v){this.attributes[k]=v},
        focus(){doc.activeElement=this},
        reportValidity(){return true},
        querySelectorAll(){return ['revenueDeductionDate','revenueDeductionAmount','revenueDeductionCancel','revenueDeductionSave'].map(element)}
      });
    }
    return elements.get(id);
  }
  let refreshed = 0;
  const FixedDate = class extends Date { static now(){return Date.parse('2026-09-13T15:05:00Z')} };
  vm.runInNewContext(source,{
    $:element,document:doc,window:win,Date:FixedDate,Number,Math,JSON,crypto:{randomUUID},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setTimeout(fn){timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),
    esc:x=>String(x).replaceAll('<','&lt;'),formatJST:x=>x,
    call:(path,opt)=>path.startsWith('/api/revenue/deductions')?getHistory(path):call(path,opt),loadCurrentRevenue:async()=>{refreshed++},loadRevenueSummary:async()=>{},setStatus(){},monthLabel:x=>x
  });
  const event = (id,type,props={}) => element(id).listeners[type]({preventDefault(){},...props});
  const fireTimers = () => { for(const fn of [...timers.values()]) fn(); timers.clear(); };
  const open = () => event('todayRevenueControl','keydown',{key:'Enter'});
  return {element,event,fireTimers,open,doc,win,refreshed:()=>refreshed};
}

test('長押しだけで開き、日本時間の当日を初期表示する。移動と指離しで中止する', () => {
  const f=fixture();
  const down=()=>f.event('todayRevenueControl','pointerdown',{isPrimary:true,button:0,clientX:50,clientY:50});
  const shown=()=>f.element('revenueDeductionModal').classList.contains('show');
  down();f.doc.listeners.pointerup();f.fireTimers();assert.equal(shown(),false);
  down();f.event('todayRevenueControl','pointermove',{clientX:70,clientY:50});f.fireTimers();assert.equal(shown(),false);
  down();f.win.listeners.scroll();f.fireTimers();assert.equal(shown(),false);
  down();f.fireTimers();assert.equal(shown(),true);
  assert.equal(f.element('revenueDeductionDate').value,'2026-09-14');
  assert.equal(f.element('revenueDeductionDate').max,'2026-09-14');
  f.event('revenueDeductionModal','keydown',{key:'Escape'});assert.equal(shown(),false);
});

test('日付と金額を送信し、保存成功後に収益表示を更新する', async () => {
  let request;
  const f=fixture(new Map(),async(path,opt)=>{
    assert.equal(path,'/api/revenue/deduct');request=JSON.parse(opt.body);
    return {ok:true,...request,month:request.date.slice(0,7),deducted_amount:request.amount};
  });
  f.open();
  f.element('revenueDeductionDate').value='2026-08-31';
  f.element('revenueDeductionAmount').value='1000';
  await f.event('revenueDeductionForm','submit');
  assert.equal(request.date,'2026-08-31');assert.equal(request.amount,1000);
  assert.equal(f.refreshed(),1);
  assert.equal(f.element('revenueDeductionModal').classList.contains('show'),true);
  assert.equal(f.element('revenueDeductionAmount').value,'');
  assert.match(f.element('revenueDeductionResult').textContent,/1,000円/);
});

test('減算ログの表示・追加読込・失敗後の再取得・空表示', async () => {
  const paths=[];
  let fail=false,empty=false;
  const f=fixture(new Map(),undefined,async path=>{
    paths.push(path);
    if(fail) throw new Error('offline');
    return {ok:true,deductions:empty?[]:[{date:'2026-09-14',amount:1000,created_at:'2026-09-14 00:00:00'}],next_cursor:empty||path.includes('?')?null:'5'};
  });
  await f.element('revenueDeductionHistoryRefresh').onclick();
  assert.match(f.element('revenueDeductionHistory').innerHTML,/対象日 2026\/09\/14/);
  assert.match(f.element('revenueDeductionHistory').innerHTML,/−1,000円/);
  assert.match(f.element('revenueDeductionHistory').innerHTML,/操作日時/);
  assert.equal(f.element('revenueDeductionHistoryMore').hidden,false);
  await f.element('revenueDeductionHistoryMore').onclick();
  assert.equal(paths[1],'/api/revenue/deductions?before=5');
  assert.equal(f.element('revenueDeductionHistoryMore').hidden,true);
  fail=true;await f.element('revenueDeductionHistoryRefresh').onclick();
  assert.match(f.element('revenueDeductionHistoryError').textContent,/取得に失敗/);
  fail=false;empty=true;await f.element('revenueDeductionHistoryRefresh').onclick();
  assert.equal(f.element('revenueDeductionHistoryError').textContent,'');
  assert.match(f.element('revenueDeductionHistory').innerHTML,/ログはありません/);
});

test('通信切断・リロード後の再送で同じ操作IDを使い、連打は1回だけ送る', async () => {
  const storage=new Map();const requests=[];
  let reject;
  const f=fixture(storage,async(path,opt)=>{
    requests.push(JSON.parse(opt.body));
    return new Promise((resolve,r)=>{reject=r});
  });
  f.open();f.element('revenueDeductionAmount').value='500';
  const first=f.event('revenueDeductionForm','submit');
  await f.event('revenueDeductionForm','submit');
  assert.equal(requests.length,1);
  reject(new Error('offline'));await first;
  assert.equal(f.element('revenueDeductionSave').textContent,'再送して確認');
  assert.equal(f.element('revenueDeductionDate').readOnly,true);
  const retry=fixture(storage,async(path,opt)=>{
    const data=JSON.parse(opt.body);requests.push(data);
    return {ok:true,...data,month:data.date.slice(0,7),deducted_amount:data.amount};
  });
  retry.open();assert.equal(retry.element('revenueDeductionAmount').value,500);
  await retry.event('revenueDeductionForm','submit');
  assert.deepEqual(requests[0],requests[1]);
  assert.equal(storage.size,0);
});
