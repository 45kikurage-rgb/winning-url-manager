const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'device-access.js'), 'utf8');

function run(){
  const listeners={};
  const removedKeys=[];
  const mainOnly={hidden:true};
  const layoutOnly={hidden:false};
  const context={
    localStorage:{removeItem:key=>removedKeys.push(key)},
    document:{
      documentElement:{dataset:{layoutDevice:'07'}},
      addEventListener:(name,fn)=>{listeners[name]=fn},
      querySelectorAll:selector=>selector==='[data-main-device-only]'?[mainOnly]:selector==='[data-layout-device-only]'?[layoutOnly]:[]
    },
    window:{}
  };
  vm.runInNewContext(source,context);
  listeners.DOMContentLoaded();
  return {context,removedKeys,mainOnly,layoutOnly};
}

test('廃止したサブ端末登録を削除し、全機能利用可にする',()=>{
  const result=run();
  assert.deepEqual(result.removedKeys,['home-layout-device-role-v1']);
  assert.equal(result.context.window.LayoutDeviceAccess.deviceId,'');
  assert.equal(result.context.window.LayoutDeviceAccess.isRestricted,false);
  assert.equal(result.context.window.LayoutDeviceAccess.isAllowedPage,true);
});

test('サブ端末専用表示を隠し、通常機能を表示する',()=>{
  const result=run();
  assert.equal(result.context.document.documentElement.dataset.layoutDevice,undefined);
  assert.equal(result.mainOnly.hidden,false);
  assert.equal(result.layoutOnly.hidden,true);
});
