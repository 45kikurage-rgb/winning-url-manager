const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'device-access.js'), 'utf8');

function run({registration=null,device='',legacyDevice='',pathname='/index.html'}={}){
  let redirected='';
  const listeners={};
  const context={
    URL,
    localStorage:{getItem:key=>{
      if(key==='home-layout-device-role-v1')return registration?JSON.stringify(registration):null;
      if(key==='home-layout-settings-v1')return device?JSON.stringify({device}):null;
      if(key==='home-layout-initial-device')return legacyDevice||null;
      return null;
    }},
    location:{pathname,href:`https://example.test${pathname}`,replace:value=>{redirected=value}},
    document:{documentElement:{dataset:{}},addEventListener:(name,fn)=>{listeners[name]=fn},querySelectorAll:()=>[],querySelector:()=>null},
    window:{}
  };
  vm.runInNewContext(source,context);
  return {access:context.window.LayoutDeviceAccess,redirected,listeners};
}

test('サブ機として設定した端末01〜15は管理画面から画面配置へ戻す',()=>{
  const result=run({registration:{role:'sub',deviceId:'7'},pathname:'/index.html'});
  assert.equal(result.access.deviceId,'07');
  assert.equal(result.access.isRestricted,true);
  assert.equal(result.redirected,'https://example.test/home-layout.html');
});

test('端末番号の選択履歴だけでは機能制限しない',()=>{
  const result=run({device:'04',legacyDevice:'04',pathname:'/index.html'});
  assert.equal(result.access.deviceId,'');
  assert.equal(result.access.isRestricted,false);
  assert.equal(result.redirected,'');
});

test('選択済み端末は画面配置ページを利用できる',()=>{
  const result=run({registration:{role:'sub',deviceId:'15'},pathname:'/home-layout-edit.html'});
  assert.equal(result.access.isAllowedPage,true);
  assert.equal(result.redirected,'');
});

test('登録端末のロックボタンはAndroidのセキュリティ設定を開く',()=>{
  const lockButton={href:''};
  const context={
    URL,
    localStorage:{getItem:key=>key==='home-layout-device-role-v1'?JSON.stringify({role:'sub',deviceId:'03'}):null},
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

test('メイン端末は端末番号の履歴があっても明示設定されるまで制限しない',()=>{
  const result=run({device:'01',legacyDevice:'01',pathname:'/index.html'});
  assert.equal(result.access.deviceId,'');
  assert.equal(result.access.isRestricted,false);
  assert.equal(result.redirected,'');
});
