const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('PayPayとえらべるPayだけ単価欄を未抽出一括コピーへ置き換える', () => {
  assert.match(html, /isPayPay\\|\\|isWalletList\\?`<button class="specialBulkCopyBtn"/);
  assert.match(html, /Number\\(l\\.unprocessed_count\\|\\|0\\).*pendingCount>0\\?'disabled'/);
  assert.match(html, /未抽出<\\/span><span class="specialBulkCopyCount">\\$\\{Number\\(l\\.unprocessed_count\\|\\|0\\)\\.toLocaleString\\(\\)\\}件 一括コピー/);
  assert.match(html, /:`<label class="unitEditor">/);
});

test('一括コピーボタンは既存のコピー確認フローを使う', () => {
  assert.match(html, /closest\\('\\.specialBulkCopyBtn'\\).*openCopyConfirm\\(item\\)/);
  assert.match(html, /function openCopyConfirm\\(item\\)[\\s\\S]*Number\\(item\\?\\.unprocessed_count\\|\\|0\\)/);
});
