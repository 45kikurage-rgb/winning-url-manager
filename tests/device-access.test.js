const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'device-access.js'), 'utf8');

function run({device='',pathname='/index.html'}={}){
  let redirected='';
  const listeners={};
  const context={
    URL,
    localStorage:{getItem:key=>key==='home-layout-initial-device'?device:null},
    location:{pathname,href:`https://example.test${pathname}`,replace:value=>{redirected=value}},
    document:{documentElement:{dataset:{}},addEventListener:(name,fn)=>{listeners[name]=fn},querySelectorAll:()=>[],querySelector:()=>null},
    window:{}
  };
  vm.runInNewContext(source,context);
  return {access:context.window.LayoutDeviceAccess,redirected,listeners};
}

test('選択済み端末01〜15は管理画面から画面配置へ戻す',()=>{
  const result=run({device:'7',pathname:'/index.html'});
  assert.equal(result.access.deviceId,'07');
  assert.equal(result.access.isRestricted,true);
  assert.equal(result.redirected,'https://example.test/home-layout.html');
});

test('選択済み端末は画面配置ページを利用できる',()=>{
  const result=run({device:'15',pathname:'/home-layout-edit.html'});
  assert.equal(result.access.isAllowedPage,true);
  assert.equal(result.redirected,'');
});

test('登録端末のロックボタンはAndroidのセキュリティ設定を開く',()=>{
  const lockButton={href:''};
  const context={
    URL,
    localStorage:{getItem:()=> '03'},
    location:{pathname:'/home-layout.html',href:'https://example.test/home-layout.html',replace:()=>{}},
    document:{
      documentElement:{dataset:{}},
      addEventListener:(_name,fn)=>fn(),
      querySelectorAll:()=>[],
      querySelector:selector=>selector==='[data-open-security-settings]'?lockButton:null
    },
    window:{}
  };
  vm.runInNewContext(source,context);
  assert.equal(lockButton.href,'intent:#Intent;action=android.settings.SECURITY_SETTINGS;end');
});

test('端末番号未選択のメイン端末は全機能を利用できる',()=>{
  const result=run({pathname:'/index.html'});
  assert.equal(result.access.deviceId,'');
  assert.equal(result.access.isRestricted,false);
  assert.equal(result.redirected,'');
});
