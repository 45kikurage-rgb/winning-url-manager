const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const index = read('index.html');
const share = read('share.html');
const cokeOn = read('cokeon-flow.js');
const textSingle = read('airwallet-flow.js');

test('新規作成と設定変更画面に入力形式・処理方法を表示する', () => {
  for (const id of ['newListInputFormat','newListProcessType','listEditInputFormat','listEditProcessType']) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  for (const value of ['url','cokeon_code','text','paypay_mixed']) assert.match(index, new RegExp(`'${value}'`));
  for (const value of ['normal','cokeon','wallet','paypay','text_single']) assert.match(index, new RegExp(`'${value}'`));
  assert.match(index, /JSON\.stringify\(\{name,input_format:inputFormat,process_type:processType/);
  assert.match(index, /input_format:inputFormat,process_type:processType,[\s\S]*folder_type:folderType/);
});

test('共有受信と専用処理はカード設定を利用する', () => {
  assert.match(share, /extractSharedItems\(destination\?\.input_format\|\|'url'\)/);
  assert.match(share, /inputFormat==='cokeon_code'/);
  assert.match(share, /inputFormat==='paypay_mixed'/);
  assert.match(cokeOn, /listProcessType\(item\)==='cokeon'/);
  assert.match(textSingle, /listProcessType\(item\)==='text_single'/);
});
