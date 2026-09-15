const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'button-display-mode.js'), 'utf8');
const STORAGE_KEY = 'winning-url-manager-button-display-mode-v1';

function run({mode='full',pathname='/index.html',search=''}={}){
  const listeners={};
  const storage=new Map();
  if(mode)storage.set(STORAGE_KEY,mode);
  const toggle={
    textContent:'',
    attributes:{},
    addEventListener:(name,fn)=>{if(name==='click')toggle.onclick=fn},
    setAttribute:(name,value)=>{toggle.attributes[name]=value}
  };
  const back={href:'./index.html'};
  const replaced=[];
  const historyUrls=[];
  const href=`https://example.test${pathname}${search}`;
  const context={
    URL,
    localStorage:{
      getItem:key=>storage.get(key)||null,
      setItem:(key,value)=>storage.set(key,value)
    },
    location:{pathname,href,replace:value=>replaced.push(value)},
    history:{replaceState:(_state,_title,url)=>historyUrls.push(url)},
    document:{
      documentElement:{dataset:{}},
      addEventListener:(name,fn)=>{listeners[name]=fn},
      querySelector:selector=>{
        if(selector==='#buttonDisplayModeBtn')return toggle;
        if(selector==='.back[href="./index.html"]')return back;
        return null;
      }
    },
    window:{}
  };
  vm.runInNewContext(source,context);
  if(listeners.DOMContentLoaded)listeners.DOMContentLoaded();
  return {context,storage,toggle,back,replaced,historyUrls};
}

test('初期状態は従来どおりボタン全部表示',()=>{
  const result=run({mode:'full'});
  assert.equal(result.replaced.length,0);
  assert.equal(result.context.document.documentElement.dataset.buttonDisplay,'full');
  assert.equal(result.toggle.textContent,'ボタン全部表示');
  assert.equal(result.toggle.attributes['aria-pressed'],'false');
});

test('表示切替を端末内へ保存し、ボタン表記も切り替える',()=>{
  const result=run({mode:'full'});
  result.toggle.onclick();
  assert.equal(result.storage.get(STORAGE_KEY),'partial');
  assert.equal(result.context.document.documentElement.dataset.buttonDisplay,'partial');
  assert.equal(result.toggle.textContent,'ボタン一部表示');
  result.toggle.onclick();
  assert.equal(result.storage.get(STORAGE_KEY),'full');
  assert.equal(result.toggle.textContent,'ボタン全部表示');
});

test('一部表示端末でサイトを開くと画面配置へ移動する',()=>{
  const result=run({mode:'partial'});
  assert.deepEqual(result.replaced,['https://example.test/home-layout.html']);
});

test('画面配置の戻るボタンからは一部表示の管理画面を開ける',()=>{
  const layout=run({mode:'partial',pathname:'/home-layout.html'});
  assert.equal(layout.back.href,'./index.html?button-controls=1');

  const index=run({mode:'partial',search:'?button-controls=1'});
  assert.equal(index.replaced.length,0);
  assert.equal(index.historyUrls[0],'/index.html');
  assert.equal(index.toggle.textContent,'ボタン一部表示');
});
