const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const exportFunction = index.match(/function exportValue\(value\)\{[\s\S]*?\n\}/)?.[0];

test('コークオンコードを指定URL＋コードへ変換する', () => {
  assert.ok(exportFunction, 'exportValue関数が見つかること');
  const context = {};
  vm.runInNewContext(`${exportFunction};this.exportValue=exportValue`, context);
  assert.equal(
    context.exportValue('cdA1B2C3D4E5F6'),
    'https://c.cocacola.co.jp/spn/app/cp/couponcode.html?couponcode=cdA1B2C3D4E5F6'
  );
});

test('コークオン形式以外の値は勝手に変換しない', () => {
  const context = {};
  vm.runInNewContext(`${exportFunction};this.exportValue=exportValue`, context);
  assert.equal(context.exportValue('https://example.com/win'), 'https://example.com/win');
  assert.equal(context.exportValue('cdSHORT'), 'cdSHORT');
});
