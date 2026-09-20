const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shareApi = require('../layout-backup-share.js');
const swSource = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function loadSw(t) {
  const listeners = {};
  const cacheStore = new Map();
  const fetched = [];
  const self = {
    location: {href: 'https://example.test/sw.js', origin: 'https://example.test'},
    addEventListener(type, handler) {
      (listeners[type] || (listeners[type] = [])).push(handler);
    },
    skipWaiting: t.skipWaiting || (() => { t.skipped = true; }),
    clients: {
      claim: async () => { t.claimed = true; },
      matchAll: async () => []
    },
    registration: {}
  };
  const context = {
    importScripts() {},
    self,
    URL,
    URLSearchParams,
    File: class File { constructor(parts, name){ this.name=name; this.size=Array.isArray(parts)?parts.length:0; } },
    Response: class Response {
      constructor(body, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.statusText = init.statusText || '';
        this.headers = new Headers(init.headers || {});
        this.ok = this.status >= 200 && this.status < 300;
      }
      static redirect(url) { return {url: String(url)}; }
      async text() { return String(this.body || ''); }
      clone() { return new context.Response(this.body, {status: this.status, statusText: this.statusText, headers: this.headers}); }
    },
    Headers: class Headers {
      constructor(init = {}) { this.map = new Map(Object.entries(init || {})); }
      get(name) { return this.map.get(String(name).toLowerCase()) || this.map.get(name) || ''; }
      delete(name) { this.map.delete(String(name).toLowerCase()); this.map.delete(name); }
    },
    caches: {
      open: async (name) => ({
        addAll: async () => { throw new Error('cache.addAll must not be used'); },
        put: async (url, response) => { cacheStore.set(String(url), response); },
        match: async (req) => cacheStore.get(typeof req === 'string' ? req : req.url) || null
      }),
      keys: async () => ['old-cache', 'winning-url-manager-20260920-webapk-v1'],
      match: async (req) => cacheStore.get(typeof req === 'string' ? req : (req && req.url)) || null,
      delete: async (name) => { t.deleted = t.deleted || []; t.deleted.push(name); }
    },
    fetch: async (url) => {
      fetched.push(String(url && url.url || url));
      if (t.fetchImpl) return t.fetchImpl(url);
      return new context.Response('ok');
    },
    LayoutBackupShare: {
      isNovaBackupFile: shareApi.isNovaBackupFile,
      MAX_BACKUP_BYTES: shareApi.MAX_BACKUP_BYTES,
      storePendingShare: async (file) => file.name,
      notificationFromPushPayload: shareApi.notificationFromPushPayload,
      notificationClickUrl: shareApi.notificationClickUrl
    },
    console
  };
  self.LayoutBackupShare = context.LayoutBackupShare;
  vm.runInNewContext(`${swSource}\nthis.listeners=self; this.handleShareTarget=handleShareTarget; this.isNavigationRequest=isNavigationRequest; this.shouldFallbackToIndex=shouldFallbackToIndex; this.precacheAssets=precacheAssets; this.activateAndClaim=activateAndClaim; this.CACHE=CACHE; this.ASSETS=ASSETS;`, context);
  t.listeners = listeners;
  t.fetched = fetched;
  t.cacheStore = cacheStore;
  t.context = context;
  t.self = self;
  return context;
}

function fakeRequest(url, extras = {}) {
  return {
    url,
    method: extras.method || 'GET',
    mode: extras.mode || 'cors',
    destination: extras.destination || '',
    headers: {
      get: (name) => (extras.accept && String(name).toLowerCase() === 'accept') ? extras.accept : ''
    }
  };
}

test('SW install は cache.addAll せず、skipWaiting / clients.claim を waitUntil 内で行う', async () => {
  const t = {};
  loadSw(t);
  assert.doesNotMatch(swSource, /cache\.addAll/);
  assert.match(swSource, /event\.waitUntil\(precacheAssets\(\)\.then\(\(\)=>self\.skipWaiting\(\)\)\)/);
  assert.match(swSource, /event\.waitUntil\(activateAndClaim\(\)\)/);
  assert.doesNotMatch(swSource, /Corporate-Logo-Rounded-Bold-ver3\.woff2/);

  const waitUntil = [];
  t.listeners.install[0]({waitUntil: (p) => waitUntil.push(p)});
  await Promise.all(waitUntil);
  assert.equal(t.skipped, true);

  const activateWait = [];
  t.listeners.activate[0]({waitUntil: (p) => activateWait.push(p)});
  await Promise.all(activateWait);
  assert.equal(t.claimed, true);
  assert.deepEqual(t.deleted, ['old-cache']);
});

test('失敗した manifest / JS / 画像 fetch には index.html を返さない', async () => {
  const t = {
    fetchImpl: async () => { throw new TypeError('offline'); }
  };
  const context = loadSw(t);
  t.cacheStore.set('https://example.test/index.html', new context.Response('<html>index</html>'));

  const answered = [];
  function fire(request) {
    t.listeners.fetch[0]({
      request,
      respondWith: (p) => answered.push(p)
    });
  }

  fire(fakeRequest('https://example.test/manifest.webmanifest?v=20260920-webapk-v1', {destination: 'manifest'}));
  fire(fakeRequest('https://example.test/layout-backup-share.js?v=20260920-webapk-v1', {destination: 'script'}));
  fire(fakeRequest('https://example.test/icon-any.png?v=20260920-webapk-v1', {destination: 'image'}));
  const responses = await Promise.all(answered);
  for (const response of responses) {
    assert.equal(response.status, 504);
    assert.notEqual(await response.text(), '<html>index</html>');
  }
  assert.equal(context.shouldFallbackToIndex(
    fakeRequest('https://example.test/manifest.webmanifest', {destination: 'manifest'}),
    new URL('https://example.test/manifest.webmanifest')
  ), false);
});

test('ナビゲーションだけ index.html にフォールバックする', async () => {
  const t = {
    fetchImpl: async () => { throw new TypeError('offline'); }
  };
  const context = loadSw(t);
  t.cacheStore.set('https://example.test/index.html', new context.Response('<html>index</html>'));
  t.cacheStore.set('./index.html', new context.Response('<html>index</html>'));

  const answered = [];
  t.listeners.fetch[0]({
    request: fakeRequest('https://example.test/share.html', {mode: 'navigate', destination: 'document'}),
    respondWith: (p) => answered.push(p)
  });
  const response = await answered[0];
  assert.equal(await response.text(), '<html>index</html>');
  assert.equal(context.isNavigationRequest(fakeRequest('https://example.test/share.html', {mode: 'navigate'})), true);
  assert.equal(context.shouldFallbackToIndex(
    fakeRequest('https://example.test/share.html', {mode: 'navigate', destination: 'document'}),
    new URL('https://example.test/share.html')
  ), true);
});

test('precaches WebAPK 用アイコンと同一キャッシュバストの manifest / share script', () => {
  const t = {};
  const context = loadSw(t);
  assert.equal(context.CACHE, 'winning-url-manager-20260920-webapk-v1');
  assert.ok(context.ASSETS.includes('./manifest.webmanifest?v=20260920-webapk-v1'));
  assert.ok(context.ASSETS.includes('./layout-backup-share.js?v=20260920-webapk-v1'));
  assert.ok(context.ASSETS.includes('./icon-any-192.png?v=20260920-webapk-v1'));
  assert.ok(context.ASSETS.includes('./icon-any.png?v=20260920-webapk-v1'));
  assert.ok(context.ASSETS.includes('./icon-maskable.png?v=20260920-webapk-v1'));
  assert.ok(!context.ASSETS.some((url) => url.includes('icon-transparent')));
});
