(() => {
  const API_DEFAULT = 'https://winning-url-api.45kikurage.workers.dev';
  const DEVICE_KEY = 'home-layout-initial-device';
  const SETTINGS_KEY = 'home-layout-settings-v1';
  const TOKEN_KEY = 'winning-url-manager-token';
  const DEVICE_TOKEN_KEY = 'winning-url-device-tokens-v1';
  const SHARE_DB = 'winning-url-manager-share-inbox';
  const SHARE_STORE = 'pending';
  const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
  const CACHE_BUST = '20260920-webapk-v2';
  const INFLIGHT_JOB_KEY = 'winning-url-manager-inflight-job-v1';
  const NOVA_BACKUP_MIME = 'application/octet-stream';
  const NOVA_OPEN_CONFIRM = 'ファイルを開きますか？';
  const NOVA_OPEN_NOTE = 'OK後しばらく空白でも正常です。ドロワーを一度開くとアイコンが出ます';
  const NOVA_OPEN_TIP = '初回は Nova を選んで「常時」';
  const NOVA_OPEN_BUTTON = 'Novaで開く';

  /*
    Aligns with winning-url-api PR #2 (https://github.com/45kikurage-rgb/winning-url-api/pull/2).
    Base: https://winning-url-api.45kikurage.workers.dev

    Device auth (share / job / push):
      X-Device-Id: 01–15
      X-Device-Token: per-device secret
      optional form fields deviceId / deviceToken

    POST /api/layout/backups/share
      multipart backupFile (+ requestId)
      Production 202 {status:"received", jobId, device, deviceLabel}
      — poll or wait for push. Never treat 202 as downloadable.
      Inline tests may return 200 inspect_ok + downloadUrl.
      Inspect NG: 422 {status:"inspect_ng", reason, downloadUrl:null}

    GET /api/layout/backups/jobs/:jobId
      inspect_ok → downloadUrl + fileName
      inspect_ng → reason, downloadUrl null

    Download: GET the signed URL once only (user tap).
      Filename: 2026-09-19_15-06_d01_xxxxxxxx.novabackup

    GET  /api/layout/push/vapid-public-key → {ok, publicKey}
    POST /api/layout/push/subscribe → {endpoint, keys}
      payloads: backup-received | backup-ready (downloadUrl) | backup-failed (reason, no URL)
      Service worker must not auto-download.
  */

  const ENDPOINTS = {
    share: '/api/layout/backups/share',
    job: (id) => `/api/layout/backups/jobs/${encodeURIComponent(id)}`,
    vapid: '/api/layout/push/vapid-public-key',
    subscribe: '/api/layout/push/subscribe'
  };

  const DEVICE_IDS = Array.from({length: 15}, (_, i) => String(i + 1).padStart(2, '0'));

  function normalizeDeviceId(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/(?:^|[\s_]|端末)0*([1-9]|1[0-5])(?:\D|$)/) || text.match(/^0*([1-9]|1[0-5])$/);
    if (!match) return '';
    const n = Number(match[1]);
    if (n < 1 || n > 15) return '';
    return String(n).padStart(2, '0');
  }

  function readBoundDevice(storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!store) return '';
    const direct = normalizeDeviceId(store.getItem(DEVICE_KEY));
    if (direct) return direct;
    try {
      const settings = JSON.parse(store.getItem(SETTINGS_KEY) || '{}');
      return normalizeDeviceId(settings.device || settings.selectedDevice || '');
    } catch {
      return '';
    }
  }

  function writeBoundDevice(device, storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    const id = normalizeDeviceId(device);
    if (!store || !id) return id;
    store.setItem(DEVICE_KEY, id);
    return id;
  }

  function readManagerToken(storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!store) return '';
    return String(store.getItem(TOKEN_KEY) || '');
  }

  function writeManagerToken(token, storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!store) return;
    store.setItem(TOKEN_KEY, String(token || ''));
  }

  function readDeviceTokenMap(storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!store) return {};
    try {
      const parsed = JSON.parse(store.getItem(DEVICE_TOKEN_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function readDeviceToken(deviceId, storage) {
    const id = normalizeDeviceId(deviceId);
    if (!id) return '';
    const map = readDeviceTokenMap(storage);
    return String(map[id] || map[String(Number(id))] || '');
  }

  function writeDeviceToken(deviceId, token, storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    const id = normalizeDeviceId(deviceId);
    if (!store || !id) return '';
    const map = readDeviceTokenMap(storage);
    const value = String(token || '').trim();
    if (value) map[id] = value;
    else delete map[id];
    store.setItem(DEVICE_TOKEN_KEY, JSON.stringify(map));
    return value;
  }

  function isNovaBackupFile(file) {
    if (!file) return false;
    const name = String(file.name || file.fileName || '').toLowerCase();
    const size = Number(file.size || file.fileSize || 0);
    return name.endsWith('.novabackup') && size > 0 && size <= MAX_BACKUP_BYTES;
  }

  function parseContentDispositionFilename(header) {
    const text = String(header || '');
    const star = text.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
    if (star) {
      try { return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, '')); } catch { /* keep going */ }
    }
    const plain = text.match(/filename\s*=\s*("(?:[^"]|\\")*"|[^;]+)/i);
    if (!plain) return '';
    return plain[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
  }

  function jstParts(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  }

  function jstStampToMinute(date) {
    const parts = jstParts(date);
    return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}`;
  }

  function suggestedFileName({device, jobId, date} = {}) {
    const id = normalizeDeviceId(device) || '00';
    const job = String(jobId || '').replace(/-/g, '').slice(0, 8) || '00000000';
    return `${jstStampToMinute(date)}_d${id}_${job}.novabackup`;
  }

  function fallbackEditedFilename(opts) {
    return suggestedFileName(opts);
  }

  function normalizeJobStatus(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return '';
    // inspect_ok / inspect_ng must win before a generic "inspect" match.
    if (value === 'inspect_ok' || value === 'backup-ready' || ['ok', 'success', 'passed', 'ready', 'done', 'complete', 'completed'].includes(value)) {
      return 'ok';
    }
    if (value === 'inspect_ng' || value === 'backup-failed' || ['ng', 'failed', 'error', 'rejected', 'invalid', 'fail'].includes(value)) {
      return 'ng';
    }
    if (value === 'backup-received' || ['received', 'queued', 'pending', 'accepted', 'uploaded'].includes(value)) {
      return 'received';
    }
    if (['inspecting', 'inspect', 'running', 'processing', 'checking'].includes(value)) {
      return 'inspecting';
    }
    return '';
  }

  function normalizePushType(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'backup-received') return 'received';
    if (value === 'backup-ready') return 'ok';
    if (value === 'backup-failed') return 'ng';
    if (value.includes('fail') || value.includes('error') || value.endsWith('_ng') || value.includes('inspect-ng')) return 'ng';
    if (value.includes('ready') || value.includes('success') || value.includes('passed') || value.endsWith('_ok') || value.includes('inspect-ok')) return 'ok';
    if (value.includes('receive') || value.includes('accept') || value.includes('upload') || value.includes('queued')) return 'received';
    if (value.includes('inspect') || value.includes('process') || value.includes('running')) return 'inspecting';
    return normalizeJobStatus(value);
  }


  function friendlyReason(reason) {
    let text = String(reason || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/\s*ジョブ\s*[0-9a-f-]{8,}\s*$/i, '').trim();
    if (!text) return '検査に失敗しました。';
    if (/WebAssembly|Wasm code generation|CompileError|__dirname|reading 'href'|Cannot read properties of undefined/i.test(text)) {
      return '検査プログラムの準備に失敗しました。もう一度共有してください。';
    }
    return text;
  }

  function formatStatusChanges(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const mapped = list.map((row, index) => {
      const name = String(row.label || row.campaign_name || row.campaignName || row.name || '').trim() || 'キャンペーン';
      const n = Number(row.loser_to_winner ?? row.transitions?.loser_to_winner ?? 0) || 0;
      const m = Number(row.unchanged ?? row.transitions?.unchanged ?? 0) || 0;
      const lines = [name];
      if (n > 0) lines.push(`ハズレ→当選 ${n}垢`);
      lines.push(`変化なし ${m}垢`);
      return {
        campaign_id: row.campaign_id || row.campaignId || '',
        campaign_name: name,
        loser_to_winner: n,
        unchanged: m,
        index,
        lines,
        line: lines.join(' / '),
        html: lines.map((line) => `<div class="statusChangeLine">${line}</div>`).join(''),
        transitions: row.transitions || null,
      };
    });
    mapped.sort((a, b) => {
      const aHit = a.loser_to_winner > 0 ? 0 : 1;
      const bHit = b.loser_to_winner > 0 ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;
      return a.index - b.index;
    });
    return mapped;
  }

  function describeBackupUi(status, extra = {}) {
    const state = normalizeJobStatus(status) || String(status || '');
    const reason = friendlyReason(extra.reason || extra.error || extra.message || '');
    if (state === 'received') {
      return {
        status: 'received',
        title: '受信しました',
        className: 'state',
        meta: '',
        panel: 'pending',
        download: false
      };
    }
    if (state === 'inspecting') {
      return {
        status: 'inspecting',
        title: '検査中…',
        className: 'state inspect',
        meta: '',
        panel: 'pending',
        download: false
      };
    }
    if (state === 'ok') {
      return {
        status: 'ok',
        title: '検査OK',
        className: 'state ok',
        meta: '',
        panel: 'ok',
        download: true
      };
    }
    if (state === 'ng') {
      const raw = String(extra.reason || extra.error || extra.message || '').replace(/\s+/g, ' ').trim();
      return {
        status: 'ng',
        title: '検査NG',
        className: 'state ng',
        meta: '',
        panel: 'ng',
        reason,
        rawReason: raw,
        download: false
      };
    }
    return {
      status: state || 'unknown',
      title: extra.title || '確認しています…',
      className: extra.className || 'state',
      meta: extra.meta || '',
      panel: 'pending',
      download: false
    };
  }

  function shareRedirectForFormData(form, originHref) {
    const file = form && (form.backupFile || form.novaBackup);
    if (file && (file instanceof File || file.size > 0)) {
      if (!isNovaBackupFile(file)) {
        return new URL('./share.html?backup_error=1', originHref).href;
      }
      return {needsStore: true, file};
    }
    const params = new URLSearchParams();
    for (const key of ['title', 'text', 'url']) {
      const value = form && form[key];
      if (typeof value === 'string' && value) params.set(key, value);
    }
    return new URL(`./share.html?${params}`, originHref).href;
  }

  function notificationFromPushPayload(payload) {
    const data = payload && typeof payload === 'object' ? payload : {body: String(payload || '')};
    const type = normalizePushType(data.type || data.status || data.event || data.kind);
    const jobId = data.jobId || data.job_id || data.id || '';
    const reason = data.reason || data.error || data.message || '';
    const fileName = data.fileName || data.file_name || '';
    const downloadUrl = type === 'ok' ? (data.downloadUrl || data.download_url || '') : '';
    const ui = describeBackupUi(type || 'received', {jobId, reason, fileName});
    const title = data.title || (
      type === 'ok' ? '配置バックアップ検査OK' :
      type === 'ng' ? '配置バックアップ検査NG' :
      type === 'inspecting' ? '配置バックアップを検査中' :
      '配置バックアップを受信しました'
    );
    const body = data.body || (
      type === 'ok' ? (fileName ? `保存できます：${fileName}` : 'タップして保存できます。') :
      type === 'ng' ? [reason || '検査に失敗しました。', jobId ? `ジョブ ${jobId}` : ''].filter(Boolean).join(' ') :
      type === 'inspecting' ? (jobId ? `ジョブ ${jobId} を検査しています。` : 'サーバーで検査しています。') :
      (jobId ? `受信しました。ジョブ ${jobId}` : '受信しました。検査を開始します。')
    );
    const actions = type === 'ok' ? [{action: 'download', title: '保存する'}] : [];
    return {
      type: type || 'received',
      title,
      options: {
        body,
        tag: jobId ? `layout-backup-${jobId}` : 'layout-backup',
        data: {
          type: type || 'received',
          jobId,
          reason,
          fileName,
          downloadUrl,
          canDownload: type === 'ok',
          openUrl: `./share.html?job=${encodeURIComponent(jobId)}`
        },
        actions,
        renotify: true
      }
    };
  }

  function notificationClickUrl(data, {download = false} = {}) {
    const jobId = data && (data.jobId || data.job_id);
    if (!jobId) return './share.html';
    if (download && data.canDownload) return `./share.html?job=${encodeURIComponent(jobId)}&download=1`;
    return `./share.html?job=${encodeURIComponent(jobId)}`;
  }

  function isOpenJobStatus(status) {
    const state = normalizeJobStatus(status);
    return state === 'received' || state === 'inspecting';
  }

  function isTerminalJobStatus(status) {
    const state = normalizeJobStatus(status);
    return state === 'ok' || state === 'ng';
  }

  function isBackupEntryParams(params) {
    const search = params instanceof URLSearchParams
      ? params
      : new URLSearchParams(params || '');
    return !!(
      search.get('backup')
      || search.get('job')
      || search.get('backup_error')
      || search.get('download')
      || search.get('mode') === 'backup'
    );
  }

  function jobPagePath(jobId, extra = {}) {
    const id = String(jobId || '').trim();
    if (!id) return './share.html?mode=backup';
    const params = new URLSearchParams();
    params.set('job', id);
    if (extra.download) params.set('download', '1');
    return `./share.html?${params}`;
  }

  function normalizeInflightJob(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const jobId = String(raw.jobId || raw.job_id || raw.id || '').trim();
    if (!jobId) return null;
    return {
      jobId,
      device: normalizeDeviceId(raw.device || raw.deviceId || raw.device_id),
      backupId: String(raw.backupId || raw.backup || '').trim(),
      status: normalizeJobStatus(raw.status) || 'received',
      fileName: String(raw.fileName || raw.file_name || '').trim(),
      updatedAt: Number(raw.updatedAt || raw.updated_at || 0) || 0
    };
  }

  function readInflightJob(storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!store) return null;
    try {
      return normalizeInflightJob(JSON.parse(store.getItem(INFLIGHT_JOB_KEY) || 'null'));
    } catch {
      return null;
    }
  }

  function writeInflightJob(job, storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    const record = normalizeInflightJob({
      ...(job || {}),
      updatedAt: Date.now()
    });
    if (!store || !record) return null;
    store.setItem(INFLIGHT_JOB_KEY, JSON.stringify(record));
    return record;
  }

  function clearInflightJob(jobId, storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!store) return null;
    const existing = readInflightJob(store);
    if (jobId && existing && existing.jobId !== String(jobId)) return existing;
    if (typeof store.removeItem === 'function') store.removeItem(INFLIGHT_JOB_KEY);
    else if (store.raw && typeof store.raw.delete === 'function') store.raw.delete(INFLIGHT_JOB_KEY);
    return null;
  }

  function claimInflightJob(job, storage) {
    const incoming = normalizeInflightJob({
      ...(job || {}),
      updatedAt: Date.now()
    });
    if (!incoming) return {ok: false, blocked: false, replaced: false, job: null, previous: null};
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    const previous = readInflightJob(store);
    const replaced = !!(
      previous
      && previous.jobId !== incoming.jobId
      && isOpenJobStatus(previous.status)
      && (!incoming.device || !previous.device || previous.device === incoming.device)
    );
    const written = writeInflightJob(incoming, store);
    return {ok: true, blocked: false, replaced, job: written, previous: replaced ? previous : null};
  }

  function restoreInflightJob(storage) {
    const existing = readInflightJob(storage);
    if (!existing || !isOpenJobStatus(existing.status)) return null;
    return existing;
  }

  function looksLikeStub(res, body) {
    if (!res) return true;
    if (res.status === 404) return true;
    const error = String((body && (body.error || body.message)) || '');
    return /not found/i.test(error);
  }

  async function parseResponse(res) {
    const text = await res.text();
    let body = text;
    try { body = text ? JSON.parse(text) : {}; } catch { body = {raw: text}; }
    return body;
  }

  async function requestJson(fetchFn, url, init) {
    const res = await fetchFn(url, init);
    const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (/octet-stream|application\/zip|application\/x-nova/i.test(contentType)) {
      return {res, body: null, binary: true, stub: false};
    }
    const body = await parseResponse(res);
    return {res, body, binary: false, stub: looksLikeStub(res, body)};
  }

  function openShareDb(indexedDBImpl) {
    const idb = indexedDBImpl || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    if (!idb) return Promise.reject(new Error('この端末では共有ファイルを保持できません。'));
    return new Promise((resolve, reject) => {
      const request = idb.open(SHARE_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SHARE_STORE)) {
          request.result.createObjectStore(SHARE_STORE, {keyPath: 'id'});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('共有ファイル領域を開けませんでした。'));
    });
  }

  async function storePendingShare(file, extras = {}, indexedDBImpl) {
    const db = await openShareDb(indexedDBImpl);
    const id = extras.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const record = {
      id,
      fileName: file.name || `backup-${Date.now()}.novabackup`,
      fileSize: file.size || 0,
      mimeType: file.type || 'application/octet-stream',
      blob: file,
      receivedAt: Date.now(),
      shared: true
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      tx.objectStore(SHARE_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = tx.onerror;
    });
    db.close();
    return id;
  }

  async function readPendingShare(id, indexedDBImpl) {
    const db = await openShareDb(indexedDBImpl);
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readonly');
      const request = tx.objectStore(SHARE_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return record;
  }

  async function deletePendingShare(id, indexedDBImpl) {
    const db = await openShareDb(indexedDBImpl);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      tx.objectStore(SHARE_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  function mapPublicJob(body, extras = {}) {
    const httpStatus = Number(extras.httpStatus || 0);
    const rawStatus = body && body.status;
    let status = normalizeJobStatus(rawStatus);
    if (httpStatus === 202) status = 'received';
    const downloadable = status === 'ok' && httpStatus !== 202;
    return {
      ok: true,
      stub: false,
      httpStatus,
      jobId: (body && (body.jobId || body.job_id || body.id)) || extras.jobId || '',
      status: status || extras.status || '',
      deviceId: normalizeDeviceId(body && (body.device || body.device_id)) || extras.deviceId || '',
      deviceLabel: (body && (body.deviceLabel || body.device_label)) || '',
      fileName: (body && (body.fileName || body.file_name)) || extras.fileName || '',
      downloadUrl: downloadable ? ((body && (body.downloadUrl || body.download_url)) || '') : '',
      reason: (body && (body.reason || body.error)) || '',
      errorCode: (body && (body.errorCode || body.error_code)) || '',
      expiresAt: (body && (body.expiresAt || body.expires_at)) || '',
      statusChanges: downloadable
        ? ((body && (body.statusChanges || body.status_changes)) || (body && body.summary && body.summary.status_changes) || [])
        : [],
      summary: downloadable ? ((body && body.summary) || null) : null,
      raw: body
    };
  }

  function createClient(deps = {}) {
    const apiBase = deps.api || API_DEFAULT;
    const fetchFn = deps.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const storage = deps.storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!fetchFn) throw new Error('fetch がありません。');

    function deviceHeaders(deviceId, extra = {}) {
      const id = normalizeDeviceId(deviceId) || readBoundDevice(storage);
      const token = readDeviceToken(id, storage);
      const headers = {...extra};
      if (id) headers['X-Device-Id'] = id;
      if (token) headers['X-Device-Token'] = token;
      return headers;
    }

    function authError(result, fallback) {
      const error = new Error((result.body && (result.body.error || result.body.reason)) || fallback || `HTTP ${result.res && result.res.status}`);
      error.status = result.res && result.res.status;
      error.body = result.body;
      return error;
    }

    async function createJob({file, deviceId, requestId, deviceToken} = {}) {
      const id = normalizeDeviceId(deviceId) || readBoundDevice(storage);
      if (deviceToken) writeDeviceToken(id, deviceToken, storage);
      const token = readDeviceToken(id, storage);
      const form = new FormData();
      const blob = (typeof Blob !== 'undefined' && file instanceof Blob)
        ? file
        : new Blob([file && file.blob ? file.blob : ''], {type: (file && file.type) || 'application/octet-stream'});
      form.append('backupFile', blob, (file && file.name) || 'backup.novabackup');
      if (requestId) form.append('requestId', requestId);
      if (id) form.append('deviceId', id);
      if (token) form.append('deviceToken', token);
      const result = await requestJson(fetchFn, apiBase + ENDPOINTS.share, {
        method: 'POST',
        headers: deviceHeaders(id, requestId ? {'X-Request-Id': requestId} : {}),
        body: form
      });
      if (result.stub) {
        return {
          ok: false,
          stub: true,
          httpStatus: result.res && result.res.status,
          status: 'received',
          downloadUrl: '',
          error: '検査APIは未公開です（winning-url-api の /api/layout/backups/share）。受信ファイルは端末に保持しています。'
        };
      }
      if (result.res.status === 202) {
        return mapPublicJob(result.body || {}, {httpStatus: 202, deviceId: id, status: 'received'});
      }
      if (result.res.status === 422 || normalizeJobStatus(result.body && result.body.status) === 'ng') {
        return mapPublicJob(result.body || {}, {httpStatus: result.res.status, deviceId: id, status: 'ng'});
      }
      if (result.res.status === 401 || result.res.status === 400 || result.res.status === 503 || !result.res.ok) {
        throw authError(result, result.res.status === 401 ? 'デバイストークンが必要です。' : `HTTP ${result.res.status}`);
      }
      return mapPublicJob(result.body || {}, {httpStatus: result.res.status, deviceId: id});
    }

    async function getJob(jobId, deviceId) {
      const result = await requestJson(fetchFn, apiBase + ENDPOINTS.job(jobId), {
        method: 'GET',
        headers: deviceHeaders(deviceId),
        cache: 'no-store'
      });
      if (result.stub) {
        return {ok: false, stub: true, jobId, status: '', downloadUrl: '', error: '検査ジョブAPIは未公開です。'};
      }
      if (result.res.status === 401) throw authError(result, 'デバイストークンが必要です。');
      if (!result.res.ok && result.res.status !== 422) throw authError(result);
      return mapPublicJob(result.body || {}, {httpStatus: result.res.status, jobId});
    }

    async function downloadSignedUrl(url, extras = {}) {
      if (!url) {
        const error = new Error('保存用URLがありません。検査OKになるまで待ってください。');
        error.status = 409;
        throw error;
      }
      const res = await fetchFn(url, {method: 'GET', cache: 'no-store'});
      if (res.status === 410) {
        const error = new Error('保存用URLは使用済みか期限切れです。もう一度共有してください。');
        error.status = 410;
        throw error;
      }
      if (!res.ok) {
        const error = new Error(`保存用URLを取得できませんでした（HTTP ${res.status}）。`);
        error.status = res.status;
        throw error;
      }
      const blob = await res.blob();
      const fileName = parseContentDispositionFilename(res.headers && res.headers.get && res.headers.get('content-disposition'))
        || extras.fileName
        || suggestedFileName({device: extras.deviceId, jobId: extras.jobId});
      return {blob, fileName, url};
    }

    async function getVapidPublicKey() {
      const result = await requestJson(fetchFn, apiBase + ENDPOINTS.vapid, {
        method: 'GET',
        cache: 'no-store'
      });
      if (result.stub || !result.res.ok) return '';
      return result.body.publicKey || result.body.public_key || result.body.vapid_public_key || result.body.key || '';
    }

    async function registerPushSubscription(subscription, deviceId) {
      const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
      const result = await requestJson(fetchFn, apiBase + ENDPOINTS.subscribe, {
        method: 'POST',
        headers: deviceHeaders(deviceId, {'Content-Type': 'application/json'}),
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys
        })
      });
      return {ok: !result.stub && result.res.ok, stub: result.stub, raw: result.body};
    }

    return {createJob, getJob, downloadSignedUrl, getVapidPublicKey, registerPushSubscription, deviceHeaders};
  }

  async function ensurePushSubscription({registration, client, deviceId} = {}) {
    if (typeof Notification === 'undefined' || !registration || !registration.pushManager) {
      return {ok: false, reason: 'unsupported'};
    }
    if (Notification.permission === 'denied') return {ok: false, reason: 'denied'};
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return {ok: false, reason: permission};
    }
    const api = client || createClient();
    const key = await api.getVapidPublicKey();
    if (!key) return {ok: false, stub: true, reason: 'vapid-stub'};
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key)
    });
    const saved = await api.registerPushSubscription(subscription, deviceId);
    return {...saved, subscription};
  }

  function triggerBrowserDownload(blob, fileName) {
    if (typeof document === 'undefined') return fileName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  }

  function ensureNovabackupFileName(fileName) {
    const name = String(fileName || '').trim() || 'backup.novabackup';
    return /\.novabackup$/i.test(name) ? name : `${name}.novabackup`;
  }

  function novaBackupShareMime(blob) {
    const type = String((blob && blob.type) || '').trim();
    if (/octet-stream|application\/zip|application\/x-nova/i.test(type)) return type;
    return NOVA_BACKUP_MIME;
  }

  function asNovaBackupFile(blob, fileName) {
    const name = ensureNovabackupFileName(fileName || (blob && blob.name));
    const type = novaBackupShareMime(blob);
    if (typeof File !== 'undefined') {
      return new File([blob], name, {type});
    }
    return typeof Blob !== 'undefined' ? new Blob([blob], {type}) : blob;
  }

  function canShareNovaBackup(file, deps = {}) {
    const shareFn = deps.share || (typeof navigator !== 'undefined' && navigator.share ? navigator.share.bind(navigator) : null);
    if (!shareFn) return false;
    const canShareFn = deps.canShare || (typeof navigator !== 'undefined' && navigator.canShare ? navigator.canShare.bind(navigator) : null);
    if (!canShareFn) return true;
    try {
      return !!canShareFn({files: [file]});
    } catch {
      return false;
    }
  }

  function defaultClickDownload(url, fileName, deps = {}) {
    const doc = deps.document || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.createElement) return false;
    const a = doc.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.target = '_blank';
    if (doc.body && typeof doc.body.appendChild === 'function') {
      doc.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      a.click();
    }
    return true;
  }

  function defaultOpenWindow(url, deps = {}) {
    const openFn = deps.openWindowFn || (typeof window !== 'undefined' && window.open ? window.open.bind(window) : null);
    if (!openFn) return false;
    try {
      return !!openFn(url, '_blank', 'noopener');
    } catch {
      return false;
    }
  }

  async function shareNovaBackupFile(file, deps = {}) {
    const shareFn = deps.share || (typeof navigator !== 'undefined' && navigator.share ? navigator.share.bind(navigator) : null);
    if (!shareFn || !canShareNovaBackup(file, deps)) {
      return {ok: false, method: '', attempted: false, aborted: false, error: null};
    }
    try {
      await shareFn({files: [file], title: file.name || 'backup.novabackup'});
      return {ok: true, method: 'share', attempted: true, aborted: false, error: null};
    } catch (error) {
      const aborted = !!(error && error.name === 'AbortError');
      return {ok: false, method: aborted ? 'share-abort' : 'share', attempted: true, aborted, error};
    }
  }

  function fallbackOpenNovaBackup(blob, fileName, deps = {}) {
    const name = ensureNovabackupFileName(fileName);
    const createObjectURL = deps.createObjectURL || (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL.bind(URL) : null);
    const revokeObjectURL = deps.revokeObjectURL || (typeof URL !== 'undefined' && URL.revokeObjectURL ? URL.revokeObjectURL.bind(URL) : null);
    if (!createObjectURL) {
      return {ok: false, method: 'fallback', attempted: false, showRetry: true};
    }
    const url = createObjectURL(blob);
    const clickDownload = deps.clickDownload || defaultClickDownload;
    const openedByClick = !!clickDownload(url, name, deps);
    const openedWindow = deps.openWindow
      ? !!deps.openWindow(url, deps)
      : !!defaultOpenWindow(url, deps);
    const delay = deps.revokeDelayMs == null ? 60000 : deps.revokeDelayMs;
    if (revokeObjectURL) {
      if (delay <= 0) revokeObjectURL(url);
      else setTimeout(() => revokeObjectURL(url), delay);
    }
    const ok = openedByClick || openedWindow;
    return {ok, method: 'open', attempted: true, showRetry: !ok};
  }

  async function openSavedNovaBackup(blob, fileName, deps = {}) {
    const file = asNovaBackupFile(blob, fileName);
    const shared = await shareNovaBackupFile(file, deps);
    if (shared.ok || shared.aborted) {
      return {
        file,
        fileName: file.name,
        confirmed: true,
        attempted: shared.attempted,
        ok: shared.ok,
        aborted: shared.aborted,
        method: shared.method,
        note: NOVA_OPEN_NOTE,
        tip: NOVA_OPEN_TIP,
        showRetry: false
      };
    }
    const fallback = fallbackOpenNovaBackup(file, file.name, deps);
    return {
      file,
      fileName: file.name,
      confirmed: true,
      attempted: shared.attempted || fallback.attempted,
      ok: fallback.ok,
      aborted: false,
      method: fallback.attempted ? fallback.method : '',
      note: NOVA_OPEN_NOTE,
      tip: NOVA_OPEN_TIP,
      showRetry: true
    };
  }

  async function offerOpenSavedBackup(blob, fileName, deps = {}) {
    const confirmFn = deps.confirm || (typeof window !== 'undefined' && window.confirm ? window.confirm.bind(window) : null);
    const confirmed = confirmFn ? !!confirmFn(NOVA_OPEN_CONFIRM) : false;
    if (!confirmed) {
      const file = asNovaBackupFile(blob, fileName);
      return {
        file,
        fileName: file.name,
        confirmed: false,
        attempted: false,
        ok: false,
        aborted: false,
        method: '',
        note: '',
        tip: '',
        showRetry: false
      };
    }
    return openSavedNovaBackup(blob, fileName, deps);
  }

  const api = {
    API_DEFAULT,
    DEVICE_KEY,
    SETTINGS_KEY,
    TOKEN_KEY,
    DEVICE_TOKEN_KEY,
    SHARE_DB,
    SHARE_STORE,
    MAX_BACKUP_BYTES,
    CACHE_BUST,
    INFLIGHT_JOB_KEY,
    NOVA_BACKUP_MIME,
    NOVA_OPEN_CONFIRM,
    NOVA_OPEN_NOTE,
    NOVA_OPEN_TIP,
    NOVA_OPEN_BUTTON,
    ENDPOINTS,
    DEVICE_IDS,
    normalizeDeviceId,
    readBoundDevice,
    writeBoundDevice,
    readManagerToken,
    writeManagerToken,
    readDeviceToken,
    writeDeviceToken,
    isNovaBackupFile,
    parseContentDispositionFilename,
    jstStampToMinute,
    suggestedFileName,
    fallbackEditedFilename,
    normalizeJobStatus,
    normalizePushType,
    describeBackupUi,
    formatStatusChanges,
    friendlyReason,
    shareRedirectForFormData,
    notificationFromPushPayload,
    notificationClickUrl,
    isOpenJobStatus,
    isTerminalJobStatus,
    isBackupEntryParams,
    jobPagePath,
    readInflightJob,
    writeInflightJob,
    clearInflightJob,
    claimInflightJob,
    restoreInflightJob,
    storePendingShare,
    readPendingShare,
    deletePendingShare,
    createClient,
    ensurePushSubscription,
    triggerBrowserDownload,
    ensureNovabackupFileName,
    novaBackupShareMime,
    asNovaBackupFile,
    canShareNovaBackup,
    shareNovaBackupFile,
    fallbackOpenNovaBackup,
    openSavedNovaBackup,
    offerOpenSavedBackup,
    urlBase64ToUint8Array
  };

  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this);
  root.LayoutBackupShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
