(() => {
  const API_DEFAULT = 'https://winning-url-api.45kikurage.workers.dev';
  const DEVICE_KEY = 'home-layout-initial-device';
  const SETTINGS_KEY = 'home-layout-settings-v1';
  const TOKEN_KEY = 'winning-url-manager-token';
  const SHARE_DB = 'winning-url-manager-share-inbox';
  const SHARE_STORE = 'pending';
  const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
  const CACHE_BUST = '20260919-layout-backup-share';

  /*
    winning-url-api layout-backup contract (not deployed on 2026-09-19).
    Client tries these paths in order and treats HTTP 404 as a stub.

    POST /api/layout/backup/jobs
      multipart: backupFile, device_id, request_id, file_name
      headers: X-Manager-Token, X-Request-Id
      200/202: {ok, job_id, status, device_id}

    GET /api/layout/backup/jobs/:id
      {ok, job_id, status: received|inspecting|ok|ng, reason, code, download_url, file_name}

    GET /api/layout/backup/jobs/:id/download
      binary + Content-Disposition filename (datetime-to-minute), or {ok, url, file_name}

    GET  /api/layout/backup/vapid-public-key  -> {ok, publicKey|vapid_public_key}
    POST /api/layout/backup/push-subscribe    -> {endpoint, keys, device_id}

    Alternates: /api/layout-backup/jobs*, /api/push/vapid-public-key, /api/push/subscribe
  */

  const ENDPOINTS = {
    createJob: ['/api/layout/backup/jobs', '/api/layout-backup/jobs'],
    job: (id) => [
      `/api/layout/backup/jobs/${encodeURIComponent(id)}`,
      `/api/layout-backup/jobs/${encodeURIComponent(id)}`
    ],
    download: (id) => [
      `/api/layout/backup/jobs/${encodeURIComponent(id)}/download`,
      `/api/layout-backup/jobs/${encodeURIComponent(id)}/download`
    ],
    vapid: ['/api/layout/backup/vapid-public-key', '/api/push/vapid-public-key', '/api/layout-backup/vapid-public-key'],
    subscribe: ['/api/layout/backup/push-subscribe', '/api/push/subscribe', '/api/layout-backup/push-subscribe']
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

  function jstStampToMinute(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
    return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
  }

  function fallbackEditedFilename({device, jobId, date} = {}) {
    const id = normalizeDeviceId(device) || '00';
    const job = String(jobId || 'job').replace(/[^\w-]+/g, '').slice(0, 24) || 'job';
    return `${id}_${jstStampToMinute(date)}_${job}_EDITED.novabackup`;
  }

  function normalizeJobStatus(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (['received', 'queued', 'pending', 'accepted', 'uploaded'].includes(value)) return 'received';
    if (['inspecting', 'inspect', 'running', 'processing', 'checking'].includes(value)) return 'inspecting';
    if (['ok', 'success', 'passed', 'ready', 'done', 'complete', 'completed'].includes(value)) return 'ok';
    if (['ng', 'failed', 'error', 'rejected', 'invalid', 'fail'].includes(value)) return 'ng';
    return '';
  }

  function normalizePushType(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (value.includes('ng') || value.includes('fail') || value.includes('error')) return 'ng';
    if (value.includes('ok') || value.includes('success') || value.includes('ready') || value.includes('passed')) return 'ok';
    if (value.includes('inspect') || value.includes('process') || value.includes('running')) return 'inspecting';
    if (value.includes('receive') || value.includes('accept') || value.includes('upload') || value.includes('queued')) return 'received';
    return normalizeJobStatus(value);
  }

  function describeBackupUi(status, extra = {}) {
    const state = normalizeJobStatus(status) || String(status || '');
    const jobId = extra.jobId || extra.job_id || '';
    const reason = extra.reason || extra.error || extra.message || '';
    if (state === 'received') {
      return {
        status: 'received',
        title: '受信しました',
        className: 'state',
        meta: jobId ? `検査待ちです。ジョブ ${jobId}` : '検査待ちです。',
        download: false
      };
    }
    if (state === 'inspecting') {
      return {
        status: 'inspecting',
        title: '検査中…',
        className: 'state inspect',
        meta: jobId ? `ジョブ ${jobId} を検査しています。` : 'サーバーで検査しています。',
        download: false
      };
    }
    if (state === 'ok') {
      return {
        status: 'ok',
        title: '検査OK',
        className: 'state ok',
        meta: extra.fileName ? `タップして保存：${extra.fileName}` : 'タップして保存できます。Novaへの自動復元はしません。',
        download: true
      };
    }
    if (state === 'ng') {
      return {
        status: 'ng',
        title: '検査NG',
        className: 'state ng',
        meta: [reason || '検査に失敗しました。', jobId ? `ジョブ ${jobId}` : ''].filter(Boolean).join(' '),
        download: false
      };
    }
    return {
      status: state || 'unknown',
      title: extra.title || '確認しています…',
      className: extra.className || 'state',
      meta: extra.meta || '',
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

  async function requestFirst(fetchFn, apiBase, paths, init) {
    let last = {res: null, body: null, path: paths[0], stub: true};
    for (const path of paths) {
      const res = await fetchFn(apiBase + path, init);
      const cloneType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (cloneType.includes('application/octet-stream') || cloneType.includes('application/zip') || cloneType.includes('application/x-nova')) {
        return {res, body: null, path, stub: false, binary: true};
      }
      const body = cloneType.includes('application/json') || res.status === 404 ? await parseResponse(res) : await parseResponse(res);
      last = {res, body, path, stub: looksLikeStub(res, body)};
      if (!last.stub) return last;
    }
    return last;
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

  function createClient(deps = {}) {
    const apiBase = deps.api || API_DEFAULT;
    const fetchFn = deps.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const storage = deps.storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!fetchFn) throw new Error('fetch がありません。');

    function authHeaders(extra = {}) {
      const token = readManagerToken(storage);
      const headers = {...extra};
      if (token) headers['X-Manager-Token'] = token;
      return headers;
    }

    async function createJob({file, deviceId, requestId}) {
      const form = new FormData();
      const blob = (typeof Blob !== 'undefined' && file instanceof Blob)
        ? file
        : new Blob([file && file.blob ? file.blob : ''], {type: (file && file.type) || 'application/octet-stream'});
      form.append('backupFile', blob, (file && file.name) || 'backup.novabackup');
      form.append('device_id', deviceId);
      form.append('request_id', requestId);
      form.append('file_name', (file && file.name) || '');
      const result = await requestFirst(fetchFn, apiBase, ENDPOINTS.createJob, {
        method: 'POST',
        headers: authHeaders({'X-Request-Id': requestId}),
        body: form
      });
      if (result.stub) {
        return {
          ok: false,
          stub: true,
          status: 'received',
          error: '検査APIは未公開です（winning-url-api の layout-backup ジョブ）。受信ファイルは端末に保持しています。'
        };
      }
      if (!result.res.ok || (result.body && result.body.ok === false)) {
        const error = new Error((result.body && (result.body.error || result.body.reason)) || `HTTP ${result.res.status}`);
        error.status = result.res.status;
        error.body = result.body;
        throw error;
      }
      return {
        ok: true,
        stub: false,
        jobId: result.body.job_id || result.body.jobId || result.body.id,
        status: normalizeJobStatus(result.body.status) || 'received',
        deviceId: result.body.device_id || deviceId,
        fileName: result.body.file_name || result.body.fileName || '',
        reason: result.body.reason || '',
        raw: result.body
      };
    }

    async function getJob(jobId) {
      const result = await requestFirst(fetchFn, apiBase, ENDPOINTS.job(jobId), {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store'
      });
      if (result.stub) {
        return {ok: false, stub: true, jobId, status: '', error: '検査ジョブAPIは未公開です。'};
      }
      if (!result.res.ok || (result.body && result.body.ok === false)) {
        const error = new Error((result.body && (result.body.error || result.body.reason)) || `HTTP ${result.res.status}`);
        error.status = result.res.status;
        throw error;
      }
      return {
        ok: true,
        stub: false,
        jobId: result.body.job_id || result.body.jobId || jobId,
        status: normalizeJobStatus(result.body.status),
        reason: result.body.reason || result.body.error || '',
        fileName: result.body.file_name || result.body.fileName || '',
        downloadUrl: result.body.download_url || result.body.downloadUrl || '',
        raw: result.body
      };
    }

    async function downloadJob(jobId) {
      const result = await requestFirst(fetchFn, apiBase, ENDPOINTS.download(jobId), {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store'
      });
      if (result.stub) {
        const error = new Error('保存用APIは未公開です。');
        error.stub = true;
        throw error;
      }
      if (result.binary || (result.res.headers && /octet-stream|zip|nova/i.test(result.res.headers.get('content-type') || ''))) {
        const blob = await result.res.blob();
        const fileName = parseContentDispositionFilename(result.res.headers.get('content-disposition')) || fallbackEditedFilename({jobId});
        return {blob, fileName, url: ''};
      }
      if (!result.res.ok || (result.body && result.body.ok === false)) {
        throw new Error((result.body && (result.body.error || result.body.reason)) || `HTTP ${result.res.status}`);
      }
      const fileName = result.body.file_name || result.body.fileName || parseContentDispositionFilename(result.res.headers && result.res.headers.get('content-disposition')) || fallbackEditedFilename({jobId});
      return {blob: null, fileName, url: result.body.url || result.body.download_url || result.body.downloadUrl || ''};
    }

    async function getVapidPublicKey() {
      const result = await requestFirst(fetchFn, apiBase, ENDPOINTS.vapid, {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store'
      });
      if (result.stub || !result.res.ok) return '';
      return result.body.publicKey || result.body.public_key || result.body.vapid_public_key || result.body.key || '';
    }

    async function registerPushSubscription(subscription, deviceId) {
      const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
      const result = await requestFirst(fetchFn, apiBase, ENDPOINTS.subscribe, {
        method: 'POST',
        headers: authHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          device_id: deviceId || readBoundDevice(storage),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        })
      });
      return {ok: !result.stub && result.res.ok, stub: result.stub, raw: result.body};
    }

    return {createJob, getJob, downloadJob, getVapidPublicKey, registerPushSubscription, authHeaders};
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

  const api = {
    API_DEFAULT,
    DEVICE_KEY,
    SETTINGS_KEY,
    TOKEN_KEY,
    SHARE_DB,
    SHARE_STORE,
    MAX_BACKUP_BYTES,
    CACHE_BUST,
    ENDPOINTS,
    DEVICE_IDS,
    normalizeDeviceId,
    readBoundDevice,
    writeBoundDevice,
    readManagerToken,
    writeManagerToken,
    isNovaBackupFile,
    parseContentDispositionFilename,
    jstStampToMinute,
    fallbackEditedFilename,
    normalizeJobStatus,
    normalizePushType,
    describeBackupUi,
    shareRedirectForFormData,
    notificationFromPushPayload,
    notificationClickUrl,
    storePendingShare,
    readPendingShare,
    deletePendingShare,
    createClient,
    ensurePushSubscription,
    triggerBrowserDownload,
    urlBase64ToUint8Array
  };

  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this);
  root.LayoutBackupShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
