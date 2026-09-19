const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const homeLayoutHtml = fs.readFileSync(path.join(__dirname, '..', 'home-layout.html'), 'utf8');

test('初期データ同期は screen / cell_x / cell_y を本番APIへ送る', () => {
  assert.match(homeLayoutHtml, /const API='https:\/\/winning-url-api\.45kikurage\.workers\.dev'/);
  assert.match(homeLayoutHtml, /apiCall\('\/api\/layout\/accounts\/sync'/);
  assert.match(
    homeLayoutHtml,
    /const accounts=extracted\.layout\.map\(row=>\(\{[\s\S]*?screen:Number\(row\.screen\),[\s\S]*?cell_x:Number\(row\.cellX\),[\s\S]*?cell_y:Number\(row\.cellY\)[\s\S]*?\}\)\)/
  );
  assert.match(homeLayoutHtml, /byPackage\.set\(appId,\{appId,lineNumber:no,displayName:String\(row\.title\|\|no\),screen:Number\(row\.screen\),cellX:Number\(row\.cellX\),cellY:Number\(row\.cellY\)\}\)/);
  assert.doesNotMatch(homeLayoutHtml, /winning-url-api-staging|pages\.dev|managerKeyBtn|stagingBanner|【検証】/);
});
