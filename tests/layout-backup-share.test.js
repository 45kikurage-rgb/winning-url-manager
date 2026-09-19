const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shareApi = require('../layout-backup-share.js');
const shareHtml = fs.readFileSync(path.join(__dirname, '..', 'share.html'), 'utf8');
const swSource = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));

test('端末01〜15だけを正規化し、16以上は拒否する', () => {
  assert.equal(shareApi.normalizeDeviceId('1'), '01');
  assert.equal(shareApi.normalizeDeviceId('端末07'), '07');
  assert.equal(shareApi.normalizeDeviceId('15'), '15');
  assert.equal(shareApi.normalizeDeviceId('16'), '');
  assert.equal(shareApi.normalizeDeviceId('26'), '');
  assert.equal(shareApi.normalizeDeviceId('00'), '');
});

test('選択済み端末は home-layout-initial-device を優先する', () => {
  const storage = new Map([[shareApi.DEVICE_KEY, '端末3']]);
  const ls = {getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value)};
  assert.equal(shareApi.readBoundDevice(ls), '03');
  shareApi.writeBoundDevice('12', ls);
  assert.equal(storage.get(shareApi.DEVICE_KEY), '12');
});

test('Content-Disposition の分単位ファイル名を優先する', () => {
  const name = shareApi.parseContentDispositionFilename(
    "attachment; filename=\"03_20260919-0656_job1_EDITED.novabackup\""
  );
  assert.equal(name, '03_20260919-0656_job1_EDITED.novabackup');
  const encoded = shareApi.parseContentDispositionFilename(
    "attachment; filename*=UTF-8''01_20260919-1201_abc_EDITED.novabackup"
  );
  assert.equal(encoded, '01_20260919-1201_abc_EDITED.novabackup');
});

test('検査状態を received / inspecting / OK / NG に正規化する', () => {
  assert.equal(shareApi.normalizeJobStatus('queued'), 'received');
  assert.equal(shareApi.normalizeJobStatus('processing'), 'inspecting');
  assert.equal(shareApi.normalizeJobStatus('passed'), 'ok');
  assert.equal(shareApi.normalizeJobStatus('failed'), 'ng');
  assert.equal(shareApi.describeBackupUi('ok', {fileName: 'a.novabackup'}).download, true);
  assert.equal(shareApi.describeBackupUi('ng', {reason: 'E_FILE_ZIP', jobId: 'j1'}).download, false);
  assert.match(shareApi.describeBackupUi('ng', {reason: 'E_FILE_ZIP', jobId: 'j1'}).meta, /E_FILE_ZIP/);
  assert.match(shareApi.describeBackupUi('ng', {reason: 'E_FILE_ZIP', jobId: 'j1'}).meta, /j1/);
});

test('共有フォームは .novabackup を share.html の検査経路へ、テキストは従来の query へ送る', () => {
  const origin = 'https://winning-url-manager.45kikurage.workers.dev/share.html';
  const file = {name: 'nova.novabackup', size: 1024};
  const stored = shareApi.shareRedirectForFormData({backupFile: file, text: 'https://example.com'}, origin);
  assert.equal(stored.needsStore, true);
  assert.equal(shareApi.isNovaBackupFile(file), true);

  const textUrl = shareApi.shareRedirectForFormData({text: 'https://example.com/win', title: 'x'}, origin);
  assert.match(textUrl, /share\.html\?/);
  assert.match(textUrl, /text=/);
  assert.doesNotMatch(textUrl, /backup=/);

  const bad = shareApi.shareRedirectForFormData({backupFile: {name: 'note.txt', size: 12}}, origin);
  assert.match(bad, /backup_error=1/);
});

test('Web Push の received / OK / NG を通知文言とアクションに分ける', () => {
  const received = shareApi.notificationFromPushPayload({type: 'layout-backup-received', jobId: 'j1'});
  assert.equal(received.type, 'received');
  assert.equal(received.options.actions.length, 0);
  assert.match(received.options.body, /j1/);

  const ok = shareApi.notificationFromPushPayload({type: 'inspect-ok', job_id: 'j2', file_name: '01_20260919-0656_j2_EDITED.novabackup'});
  assert.equal(ok.type, 'ok');
  assert.equal(ok.options.data.canDownload, true);
  assert.deepEqual(ok.options.actions, [{action: 'download', title: '保存する'}]);
  assert.equal(shareApi.notificationClickUrl(ok.options.data, {download: true}), './share.html?job=j2&download=1');

  const ng = shareApi.notificationFromPushPayload({type: 'inspect-ng', jobId: 'j3', reason: 'E_DEVICE_MISMATCH'});
  assert.equal(ng.type, 'ng');
  assert.equal(ng.options.data.canDownload, false);
  assert.equal(ng.options.data.downloadUrl, '');
  assert.match(ng.options.body, /E_DEVICE_MISMATCH/);
  assert.match(ng.options.body, /j3/);
  assert.equal(shareApi.notificationClickUrl(ng.options.data, {download: true}), './share.html?job=j3');
});

test('検査APIが 404 のときは stub として扱い、ジョブ作成を落とさない', async () => {
  const calls = [];
  const client = shareApi.createClient({
    api: 'https://winning-url-api.45kikurage.workers.dev',
    storage: {getItem: () => 'secret', setItem(){}},
    fetch: async (url, init) => {
      calls.push({url, hasToken: !!(init.headers && init.headers['X-Manager-Token']), body: init.body});
      return {
        ok: false,
        status: 404,
        headers: {get: () => 'application/json'},
        text: async () => JSON.stringify({ok: false, error: 'Not Found'})
      };
    }
  });
  const created = await client.createJob({
    file: {name: 'x.novabackup', size: 8},
    deviceId: '01',
    requestId: 'req-1'
  });
  assert.equal(created.stub, true);
  assert.equal(created.status, 'received');
  assert.equal(calls[0].hasToken, true);
  assert.match(calls[0].url, /\/api\/layout\/backup\/jobs$/);
});

test('PWA名は URL送信のまま、share_target は1つで backupFile を受け取る', () => {
  assert.equal(manifest.short_name, 'URL送信');
  assert.equal(manifest.name, '当選URL管理');
  assert.ok(manifest.share_target);
  assert.equal(manifest.share_target.action, './share.html');
  assert.equal(manifest.share_target.params.files[0].name, 'backupFile');
  assert.ok(manifest.share_target.params.files[0].accept.includes('.novabackup'));
});

test('share.html は当選URL送信を残し、.novabackup を検査ジョブへ分岐する', () => {
  assert.match(shareHtml, /\/api\/submit-batch/);
  assert.match(shareHtml, /extractSharedItems/);
  assert.match(shareHtml, /LayoutBackupShare/);
  assert.match(shareHtml, /backupFile/);
  assert.match(shareHtml, /検査OK/);
  assert.match(shareHtml, /タップして保存/);
  assert.doesNotMatch(shareHtml, /当選管理/);
  assert.doesNotMatch(shareHtml, /nova:\/\//i);
});

test('service worker は共有ファイルを share.html へ渡し、push の OK/NG を扱う', () => {
  assert.match(swSource, /importScripts\('\.\/layout-backup-share\.js/);
  assert.match(swSource, /share\.html\?backup=/);
  assert.doesNotMatch(swSource, /home-layout\.html#received/);
  assert.match(swSource, /addEventListener\('push'/);
  assert.match(swSource, /addEventListener\('notificationclick'/);
  assert.match(swSource, /notificationFromPushPayload/);
  assert.match(swSource, /20260919-layout-backup-share/);
});

test('SW の共有分岐を実行すると backup は share.html、テキストは既存 query になる', async () => {
  const stored = [];
  const self = {
    location: {href: 'https://example.test/sw.js', origin: 'https://example.test'},
    addEventListener(){},
    skipWaiting(){},
    clients: {claim(){}, matchAll: async () => []},
    registration: {}
  };
  const context = {
    importScripts(){},
    self,
    URL,
    URLSearchParams,
    File: class File { constructor(parts, name){ this.name=name; this.size=Array.isArray(parts)?parts.length:0; } },
    Response: {redirect: (url) => ({url: String(url)})},
    Headers: class Headers { delete(){} },
    caches: {open: async () => ({addAll: async () => {}}), keys: async () => [], match: async () => null, delete: async () => {}},
    LayoutBackupShare: {
      isNovaBackupFile: shareApi.isNovaBackupFile,
      MAX_BACKUP_BYTES: shareApi.MAX_BACKUP_BYTES,
      storePendingShare: async (file) => { stored.push(file.name); return 'pending-1'; },
      notificationFromPushPayload: shareApi.notificationFromPushPayload,
      notificationClickUrl: shareApi.notificationClickUrl
    },
    console
  };
  self.LayoutBackupShare = context.LayoutBackupShare;
  vm.runInNewContext(`${swSource}\nthis.handleShareTarget = handleShareTarget;`, context);
  const backup = await context.handleShareTarget({
    formData: async () => ({
      get: (key) => key === 'backupFile' ? {name: 'a.novabackup', size: 2048} : null
    })
  });
  assert.deepEqual(stored, ['a.novabackup']);
  assert.match(backup.url, /share\.html\?backup=pending-1/);

  const text = await context.handleShareTarget({
    formData: async () => ({
      get: (key) => key === 'text' ? 'https://example.com/win' : null
    })
  });
  assert.match(text.url, /share\.html\?text=/);
  assert.doesNotMatch(text.url, /backup=/);
});
