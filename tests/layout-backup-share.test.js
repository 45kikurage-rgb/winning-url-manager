const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shareApi = require('../layout-backup-share.js');
const shareHtml = fs.readFileSync(path.join(__dirname, '..', 'share.html'), 'utf8');
const swSource = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));

function memoryStorage(seed = {}) {
  const storage = new Map(Object.entries(seed));
  return {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    raw: storage
  };
}

function jsonResponse(status, body, extra = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {get: (name) => extra.headers && extra.headers[String(name).toLowerCase()] || 'application/json'},
    text: async () => JSON.stringify(body),
    blob: extra.blob ? async () => extra.blob : undefined
  };
}

test('端末01〜15だけを正規化し、16以上は拒否する', () => {
  assert.equal(shareApi.normalizeDeviceId('1'), '01');
  assert.equal(shareApi.normalizeDeviceId('端末07'), '07');
  assert.equal(shareApi.normalizeDeviceId('15'), '15');
  assert.equal(shareApi.normalizeDeviceId('16'), '');
  assert.equal(shareApi.normalizeDeviceId('26'), '');
  assert.equal(shareApi.normalizeDeviceId('00'), '');
});

test('選択済み端末は home-layout-initial-device を優先する', () => {
  const ls = memoryStorage({[shareApi.DEVICE_KEY]: '端末3'});
  assert.equal(shareApi.readBoundDevice(ls), '03');
  shareApi.writeBoundDevice('12', ls);
  assert.equal(ls.raw.get(shareApi.DEVICE_KEY), '12');
});

test('Content-Disposition の分単位ファイル名を優先する', () => {
  const name = shareApi.parseContentDispositionFilename(
    'attachment; filename="2026-09-19_15-06_d01_a1b2c3d4.novabackup"'
  );
  assert.equal(name, '2026-09-19_15-06_d01_a1b2c3d4.novabackup');
  const encoded = shareApi.parseContentDispositionFilename(
    "attachment; filename*=UTF-8''2026-09-19_12-01_d01_abcdef12.novabackup"
  );
  assert.equal(encoded, '2026-09-19_12-01_d01_abcdef12.novabackup');
});

test('フォールバックファイル名は 日付_時刻_d端末_ジョブ短縮.novabackup', () => {
  const name = shareApi.suggestedFileName({
    device: '01',
    jobId: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
    date: new Date('2026-09-19T06:06:00.000Z')
  });
  assert.match(name, /^2026-09-19_\d{2}-\d{2}_d01_a1b2c3d4\.novabackup$/);
});

test('検査状態を received / inspecting / OK / NG に正規化する', () => {
  assert.equal(shareApi.normalizeJobStatus('queued'), 'received');
  assert.equal(shareApi.normalizeJobStatus('processing'), 'inspecting');
  assert.equal(shareApi.normalizeJobStatus('inspect_ok'), 'ok');
  assert.equal(shareApi.normalizeJobStatus('inspect_ng'), 'ng');
  assert.equal(shareApi.normalizeJobStatus('inspect'), 'inspecting');
  assert.equal(shareApi.normalizeJobStatus('passed'), 'ok');
  assert.equal(shareApi.normalizeJobStatus('failed'), 'ng');
  assert.equal(shareApi.describeBackupUi('ok', {fileName: 'a.novabackup'}).download, true);
  assert.equal(shareApi.describeBackupUi('received').download, false);
  const ng = shareApi.describeBackupUi('ng', {reason: 'E_FILE_ZIP', jobId: 'j1'});
  assert.equal(ng.download, false);
  assert.equal(ng.panel, 'ng');
  assert.match(ng.reason, /E_FILE_ZIP/);
  assert.match(ng.rawReason, /E_FILE_ZIP/);
  assert.equal(ng.meta, '');
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

test('Web Push の backup-received / backup-ready / backup-failed を通知文言とアクションに分ける', () => {
  const received = shareApi.notificationFromPushPayload({type: 'backup-received', jobId: 'j1'});
  assert.equal(received.type, 'received');
  assert.equal(received.options.actions.length, 0);
  assert.match(received.options.body, /j1/);

  const ok = shareApi.notificationFromPushPayload({
    type: 'backup-ready',
    job_id: 'j2',
    file_name: '2026-09-19_15-06_d01_a1b2c3d4.novabackup',
    downloadUrl: 'https://example.test/signed'
  });
  assert.equal(ok.type, 'ok');
  assert.equal(ok.options.data.canDownload, true);
  assert.equal(ok.options.data.downloadUrl, 'https://example.test/signed');
  assert.deepEqual(ok.options.actions, [{action: 'download', title: '保存する'}]);
  assert.equal(shareApi.notificationClickUrl(ok.options.data, {download: true}), './share.html?job=j2&download=1');

  const ng = shareApi.notificationFromPushPayload({type: 'backup-failed', jobId: 'j3', reason: 'E_DEVICE_MISMATCH'});
  assert.equal(ng.type, 'ng');
  assert.equal(ng.options.data.canDownload, false);
  assert.equal(ng.options.data.downloadUrl, '');
  assert.match(ng.options.body, /E_DEVICE_MISMATCH/);
  assert.match(ng.options.body, /j3/);
  assert.equal(shareApi.notificationClickUrl(ng.options.data, {download: true}), './share.html?job=j3');
});

test('検査APIが 404 のときは stub として扱い、ジョブ作成を落とさない', async () => {
  const calls = [];
  const storage = memoryStorage({
    [shareApi.DEVICE_KEY]: '01',
    [shareApi.DEVICE_TOKEN_KEY]: JSON.stringify({ '01': 'dev-secret' })
  });
  const client = shareApi.createClient({
    api: 'https://winning-url-api.45kikurage.workers.dev',
    storage,
    fetch: async (url, init) => {
      calls.push({
        url,
        headers: init.headers,
        deviceId: init.headers && init.headers['X-Device-Id'],
        deviceToken: init.headers && init.headers['X-Device-Token'],
        managerToken: init.headers && init.headers['X-Manager-Token'],
        body: init.body
      });
      return jsonResponse(404, {ok: false, error: 'Not Found'});
    }
  });
  const created = await client.createJob({
    file: {name: 'x.novabackup', size: 8},
    deviceId: '01',
    requestId: 'req-1'
  });
  assert.equal(created.stub, true);
  assert.equal(created.status, 'received');
  assert.equal(created.downloadUrl, '');
  assert.equal(calls[0].deviceId, '01');
  assert.equal(calls[0].deviceToken, 'dev-secret');
  assert.equal(calls[0].managerToken, undefined);
  assert.match(calls[0].url, /\/api\/layout\/backups\/share$/);
  assert.equal(calls[0].body.get('backupFile').name, 'x.novabackup');
  assert.equal(calls[0].body.get('requestId'), 'req-1');
  assert.equal(calls[0].headers && calls[0].headers['X-Request-Id'], 'req-1');
  assert.equal(calls[0].body.get('deviceId'), '01');
  assert.equal(calls[0].body.get('deviceToken'), 'dev-secret');
});

test('本番 202 received はダウンロード不可。200 inspect_ok / 422 inspect_ng をそのまま返す', async () => {
  const calls = [];
  const storage = memoryStorage({
    [shareApi.DEVICE_KEY]: '01',
    [shareApi.DEVICE_TOKEN_KEY]: JSON.stringify({ '01': 'tok' })
  });
  const replies = [
    jsonResponse(202, {ok: true, status: 'received', jobId: 'job-202', device: '01', deviceLabel: '端末01', fileName: null}),
    jsonResponse(200, {
      ok: true,
      status: 'inspect_ok',
      jobId: 'job-200',
      device: '01',
      fileName: '2026-09-19_15-06_d01_aaaaaaaa.novabackup',
      downloadUrl: 'https://winning-url-api.45kikurage.workers.dev/api/layout/backups/download/job-200?sig=1'
    }),
    jsonResponse(422, {ok: true, status: 'inspect_ng', jobId: 'job-422', reason: 'ZIPとして展開できません。', downloadUrl: null})
  ];
  const client = shareApi.createClient({
    api: 'https://winning-url-api.45kikurage.workers.dev',
    storage,
    fetch: async (url, init) => {
      calls.push({url, method: init.method, headers: init.headers});
      return replies.shift();
    }
  });

  const accepted = await client.createJob({file: {name: 'a.novabackup', size: 4}, deviceId: '01', requestId: 'r1'});
  assert.equal(accepted.httpStatus, 202);
  assert.equal(accepted.status, 'received');
  assert.equal(accepted.jobId, 'job-202');
  assert.equal(accepted.downloadUrl, '');
  assert.equal(shareApi.describeBackupUi(accepted.status).download, false);

  const ok = await client.createJob({file: {name: 'a.novabackup', size: 4}, deviceId: '01', requestId: 'r2'});
  assert.equal(ok.status, 'ok');
  assert.equal(ok.fileName, '2026-09-19_15-06_d01_aaaaaaaa.novabackup');
  assert.match(ok.downloadUrl, /\/api\/layout\/backups\/download\/job-200/);

  const ng = await client.createJob({file: {name: 'a.novabackup', size: 4}, deviceId: '01', requestId: 'r3'});
  assert.equal(ng.status, 'ng');
  assert.equal(ng.downloadUrl, '');
  assert.match(ng.reason, /ZIP/);
});

test('ジョブポーリングは GET /api/layout/backups/jobs/:id と端末ヘッダだけを使う', async () => {
  const calls = [];
  const storage = memoryStorage({
    [shareApi.DEVICE_KEY]: '02',
    [shareApi.DEVICE_TOKEN_KEY]: JSON.stringify({ '02': 'tok-02' })
  });
  const client = shareApi.createClient({
    api: 'https://winning-url-api.45kikurage.workers.dev',
    storage,
    fetch: async (url, init) => {
      calls.push({url, headers: init.headers});
      return jsonResponse(200, {
        ok: true,
        status: 'inspect_ok',
        jobId: 'job-9',
        fileName: '2026-09-19_15-06_d02_bbbbbbbb.novabackup',
        downloadUrl: 'https://signed.example/once'
      });
    }
  });
  const job = await client.getJob('job-9', '02');
  assert.equal(job.status, 'ok');
  assert.equal(job.downloadUrl, 'https://signed.example/once');
  assert.match(calls[0].url, /\/api\/layout\/backups\/jobs\/job-9$/);
  assert.equal(calls[0].headers['X-Device-Id'], '02');
  assert.equal(calls[0].headers['X-Device-Token'], 'tok-02');
  assert.equal(calls[0].headers['X-Manager-Token'], undefined);
});

test('保存は署名URLを1回だけ GET し、未署名の download エンドポイントは叩かない', async () => {
  const calls = [];
  const client = shareApi.createClient({
    api: 'https://winning-url-api.45kikurage.workers.dev',
    storage: memoryStorage(),
    fetch: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        headers: {get: (name) => name.toLowerCase() === 'content-disposition' ? 'attachment; filename="2026-09-19_15-06_d01_cccccccc.novabackup"' : 'application/octet-stream'},
        blob: async () => new Blob(['pack'])
      };
    }
  });
  const signed = 'https://winning-url-api.45kikurage.workers.dev/api/layout/backups/download/job-9?exp=1&jti=2&sig=3';
  const result = await client.downloadSignedUrl(signed, {deviceId: '01', jobId: 'job-9'});
  assert.deepEqual(calls, [signed]);
  assert.equal(result.fileName, '2026-09-19_15-06_d01_cccccccc.novabackup');
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
  assert.match(shareHtml, /タップして編集データを保存/);
  assert.match(shareHtml, /downloadSignedUrl/);
  assert.match(shareHtml, /writeDeviceToken/);
  assert.match(shareHtml, /デバイストークン/);
  assert.doesNotMatch(shareHtml, /当選管理/);
  assert.doesNotMatch(shareHtml, /nova:\/\//i);
  assert.doesNotMatch(shareHtml, /writeManagerToken/);
  assert.doesNotMatch(shareHtml, /downloadJob\(/);
  assert.doesNotMatch(shareHtml, /\/api\/layout\/backup\/jobs/);
});

test('service worker は共有ファイルを share.html へ渡し、push では自動保存しない', () => {
  assert.match(swSource, /importScripts\('\.\/layout-backup-share\.js/);
  assert.match(swSource, /share\.html\?backup=/);
  assert.doesNotMatch(swSource, /home-layout\.html#received/);
  assert.match(swSource, /addEventListener\('push'/);
  assert.match(swSource, /addEventListener\('notificationclick'/);
  assert.match(swSource, /notificationFromPushPayload/);
  assert.match(swSource, /Must not auto-download/);
  assert.match(swSource, /20260920-share-fallback-v1/);
  assert.doesNotMatch(swSource, /payload\.downloadUrl/);
  assert.doesNotMatch(swSource, /fetch\(payload/);
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
      get: (key) => key === 'text' ? 'https://example.com/win' : null,
      values: function* () {}
    })
  });
  assert.match(text.url, /share\.html\?text=/);
  assert.doesNotMatch(text.url, /backup=/);

  const empty = await context.handleShareTarget({
    formData: async () => ({
      get: () => null,
      values: function* () {}
    })
  });
  assert.match(empty.url, /share\.html\?backup_error=1/);
});

test('正確な API パスとキャッシュバストが share / SW に載っている', () => {
  assert.equal(shareApi.ENDPOINTS.share, '/api/layout/backups/share');
  assert.equal(shareApi.ENDPOINTS.job('abc'), '/api/layout/backups/jobs/abc');
  assert.equal(shareApi.ENDPOINTS.vapid, '/api/layout/push/vapid-public-key');
  assert.equal(shareApi.ENDPOINTS.subscribe, '/api/layout/push/subscribe');
  assert.equal(shareApi.CACHE_BUST, '20260920-share-fallback-v1');
  assert.match(shareHtml, /20260920-share-fallback-v1/);
  assert.match(swSource, /\/api\/layout\/push\/vapid-public-key|layout-backup-share\.js\?v=20260920-share-fallback-v1/);
});

test('検査OK用のキャンペーン状態変化文言を組み立てる（変化なし0も表示）', () => {
  const rows = shareApi.formatStatusChanges([
    {campaign_id: 'c1', campaign_name: 'やかんの麦茶', loser_to_winner: 2, unchanged: 0},
    {label: '夏祭り', transitions: {loser_to_winner: 0, unchanged: 0}},
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].lines, ['やかんの麦茶', 'ハズレ→当選 2垢', '変化なし 0垢']);
  assert.deepEqual(rows[1].lines, ['夏祭り', '変化なし 0垢']);
  assert.equal(rows[0].loser_to_winner, 2);
  assert.equal(shareApi.friendlyReason('CompileError: WebAssembly.instantiate(): Wasm code generation disallowed by embedder ジョブ 76df56fe-6c34-4830-a061-be041634af6b'), '検査プログラムの準備に失敗しました。もう一度共有してください。');
});

test('share.html は検査OK用パネルと編集データ保存ボタンを持つ', () => {
  assert.match(shareHtml, /id="backupPanel"/);
  assert.match(shareHtml, /タップして編集データを保存/);
  assert.match(shareHtml, /backupMode/);
  assert.doesNotMatch(shareHtml, /id="statusChanges"/);
  const panelPos = shareHtml.indexOf('id="backupPanel"');
  const savePos = shareHtml.indexOf('タップして編集データを保存');
  assert.ok(panelPos > -1 && savePos > panelPos);
});

test('新しいバックアップ選択では送信IDを更新し、同じ通信の再送だけIDを維持する', () => {
  assert.match(shareHtml, /function nextRequestId\(\)/);
  assert.match(shareHtml, /async function uploadBackup\(file,\{reuseRequestId=false\}=\{\}\)/);
  assert.match(shareHtml, /if\(!reuseRequestId\|\|!requestId\)nextRequestId\(\)/);
  assert.match(shareHtml, /uploadBackup\(backupFile,\{reuseRequestId:true\}\)/);
  assert.match(shareHtml, /if\(await promptDeviceTokenIfNeeded\(error\)\)return uploadBackup\(file,\{reuseRequestId:true\}\)/);
  assert.match(shareHtml, /if\(file\)uploadBackup\(file\);/);
  assert.match(shareHtml, /createJob\(\{file,deviceId:device,requestId\}\)/);
  assert.match(shareHtml, /const API = 'https:\/\/winning-url-api\.45kikurage\.workers\.dev'/);
  assert.doesNotMatch(shareHtml, /winning-url-api-staging|pages\.dev|stagingBanner|【検証】/);
  assert.equal(shareApi.API_DEFAULT, 'https://winning-url-api.45kikurage.workers.dev');
});

test('共有用 File は .novabackup 名と Android 受け渡し可能な MIME を保つ', () => {
  const unnamed = shareApi.asNovaBackupFile(new Blob(['pack']), '2026-09-19_15-06_d07_abcd1234.novabackup');
  assert.equal(unnamed.name, '2026-09-19_15-06_d07_abcd1234.novabackup');
  assert.equal(unnamed.type, 'application/octet-stream');

  const zipped = shareApi.asNovaBackupFile(
    new Blob(['pack'], {type: 'application/zip'}),
    'edited'
  );
  assert.equal(zipped.name, 'edited.novabackup');
  assert.equal(zipped.type, 'application/zip');
  assert.equal(shareApi.ensureNovabackupFileName('keep.novabackup'), 'keep.novabackup');
});

test('保存成功後は確認してから navigator.share で Nova へ渡す', async () => {
  const blob = new Blob(['pack'], {type: 'application/octet-stream'});
  const shares = [];
  const declined = await shareApi.offerOpenSavedBackup(blob, '2026-09-19_15-06_d07_abcd1234.novabackup', {
    confirm: () => false,
    share: async (payload) => { shares.push(payload); }
  });
  assert.equal(declined.confirmed, false);
  assert.equal(declined.attempted, false);
  assert.equal(declined.showRetry, false);
  assert.equal(shares.length, 0);

  const accepted = await shareApi.offerOpenSavedBackup(blob, '2026-09-19_15-06_d07_abcd1234.novabackup', {
    confirm: (message) => {
      assert.equal(message, shareApi.NOVA_OPEN_CONFIRM);
      return true;
    },
    canShare: () => true,
    share: async (payload) => { shares.push(payload); }
  });
  assert.equal(accepted.confirmed, true);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.method, 'share');
  assert.equal(accepted.showRetry, false);
  assert.equal(accepted.fileName, '2026-09-19_15-06_d07_abcd1234.novabackup');
  assert.equal(accepted.note, shareApi.NOVA_OPEN_NOTE);
  assert.equal(accepted.tip, shareApi.NOVA_OPEN_TIP);
  assert.equal(shares.length, 1);
  assert.equal(shares[0].files[0].name, '2026-09-19_15-06_d07_abcd1234.novabackup');
  assert.equal(shares[0].files[0].type, 'application/octet-stream');
});

test('共有できないときは object URL フォールバックと再試行ボタンを返す', async () => {
  const blob = new Blob(['pack']);
  const clicks = [];
  const opens = [];
  const result = await shareApi.offerOpenSavedBackup(blob, 'd07.novabackup', {
    confirm: () => true,
    share: null,
    createObjectURL: () => 'blob:test-nova',
    revokeObjectURL: () => {},
    revokeDelayMs: 0,
    clickDownload: (url, name) => { clicks.push({url, name}); return true; },
    openWindow: (url) => { opens.push(url); return false; }
  });
  assert.equal(result.confirmed, true);
  assert.equal(result.method, 'open');
  assert.equal(result.showRetry, true);
  assert.equal(result.note, shareApi.NOVA_OPEN_NOTE);
  assert.deepEqual(clicks, [{url: 'blob:test-nova', name: 'd07.novabackup'}]);
  assert.deepEqual(opens, ['blob:test-nova']);
});

test('share.html は保存成功後にファイルを開く確認と Nova 受け渡しを持つ', () => {
  assert.equal(shareApi.NOVA_OPEN_CONFIRM, 'ファイルを開きますか？');
  assert.equal(shareApi.NOVA_OPEN_NOTE, 'OK後しばらく空白でも正常です。ドロワーを一度開くとアイコンが出ます');
  assert.equal(shareApi.NOVA_OPEN_TIP, '初回は Nova を選んで「常時」');
  assert.equal(shareApi.NOVA_OPEN_BUTTON, 'Novaで開く');
  assert.match(shareHtml, /Novaで開く/);
  assert.match(shareHtml, /offerOpenSavedBackup/);
  assert.match(shareHtml, /openSavedNovaBackup/);
  assert.match(shareHtml, /triggerBrowserDownload\(result\.blob,result\.fileName\)/);
  assert.match(shareHtml, /await promptOpenSavedBackup\(result\.blob,result\.fileName\)/);
  assert.match(shareHtml, /id="openNovaNote"/);
  assert.match(shareHtml, /id="openNovaBtn"/);
  assert.doesNotMatch(shareHtml, /復元中|Nova復元を待|nova:\/\//i);
  assert.doesNotMatch(shareHtml, /winning-url-api-staging|pages\.dev|stagingBanner|【検証】/);
});
