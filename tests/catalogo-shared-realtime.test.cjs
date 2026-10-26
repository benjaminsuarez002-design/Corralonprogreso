const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function sharedLocks() {
  const queues = new Map();
  return { request(key, fn) {
    const task = (queues.get(key) || Promise.resolve()).then(fn);
    queues.set(key, task.catch(() => {}));
    return task;
  } };
}

test('cinco pestañas reciben el mismo cambio y descargan una vez, sin bucles de actualizaciones locales', async () => {
  const source = read('corralon-system.js');
  const code = source.slice(source.indexOf('    async function startCatalogLoad('), source.indexOf('    function startFullLoad('));
  let cached = { source: 'supabase', version: 1, patchVersion: 1, rows: [{ codigo: '1', fotoUrl: 'vieja' }] }, downloads = 0, notices = 0;
  const locks = sharedLocks(), tabs = [];
  for (let i = 0; i < 5; i++) {
    const events = [];
    const box = { console, navigator: { locks }, memoryCache: null, readCache: async () => cached, cacheHasRubros: () => true,
      CATALOG_REALTIME: { cacheReady() { notices++; } },
      window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      canApplyPatches: context => context.patchVersion > context.cached.patchVersion,
      startPatchLoad: async context => { downloads++; await flush(); cached = { ...cached, version: context.version, patchVersion: context.patchVersion, rows: [{ codigo: '1', fotoUrl: 'nueva' }] }; return cached.rows; },
      canApplyDelta: () => false, startDeltaLoad() { assert.fail('delta inesperado'); }, startFullLoad() { assert.fail('descarga completa inesperada'); }, alignCachedVersion: context => context.cached.rows
    };
    vm.createContext(box); vm.runInContext(code + '\nglobalThis.load = startCatalogLoad;', box); tabs.push({ box, events });
  }
  const old = cached;
  await Promise.all(tabs.map(tab => tab.box.load({ cached: old, version: 2, patchVersion: 2 })));
  assert.equal(downloads, 1); assert.equal(notices, 1);
  assert.equal(tabs[1].events[0].detail.rows[0].fotoUrl, 'nueva');
  await Promise.all(tabs.map(tab => tab.box.load({ cached, version: 2, patchVersion: 2 })));
  assert.equal(downloads, 1); assert.equal(tabs[1].events.length, 1);
});

test('la validación de remitos se comparte y consulta solo una notificación nueva o modificada', async () => {
  const source = read('menu.html');
  const code = source.slice(source.indexOf('    async function cleanupOrphanRemitoNotifications()'), source.indexOf('    function setupReviewNotifications'));
  let reads = 0; const stored = {};
  const item = { tipo: 'remito', id: 255, firestoreId: 'remito_255', updatedAt: { seconds: 1 } };
  const box = { console, navigator: { locks: sharedLocks() }, historialNotifications: [item],
    localStorage: { getItem: key => stored[key] || null, setItem: (key, value) => { stored[key] = value; } },
    fetch: async () => { reads++; return { ok: true, json: async () => [{ id: 255 }] }; },
    SUPABASE_URL: 'test', SUPABASE_KEY: 'test', setDoc() { assert.fail('el remito existente no se resuelve'); }, renderReviewNotifications() {}
  };
  vm.createContext(box); vm.runInContext(code + '\nglobalThis.cleanup = cleanupOrphanRemitoNotifications;', box);
  await Promise.all([box.cleanup(), box.cleanup()]); await box.cleanup(); assert.equal(reads, 1);
  box.historialNotifications = [{ ...item, updatedAt: { seconds: 2 } }]; await box.cleanup(); assert.equal(reads, 2);
});

test('la foto usa solo la copia local, incluso si no hay artículo', async () => {
  const source = read('corralon-system.js');
  const code = source.slice(source.indexOf('    async function cachedArticle('), source.indexOf('    async function cachedRows('));
  const box = { memoryCache: {}, loadCachedAridosConfig: async () => {}, decorateAridArticle: row => row, readCache: async () => ({ rows: [{ codigo: '1', fotoUrl: 'foto-local' }] }), codeOf: row => row.codigo, fetch() { assert.fail('no debe consultar la red'); } };
  vm.createContext(box); vm.runInContext(code + '\nglobalThis.photo = cachedArticle;', box);
  assert.equal((await box.photo('1')).fotoUrl, 'foto-local'); assert.equal(await box.photo('2'), null);
});


test('un aviso de proveedor simultáneo en dos pestañas descarga el JSON una sola vez', async () => {
  const source = read('corralon-system.js');
  const code = source.slice(source.indexOf('    async function syncProviderNotice('), source.indexOf('    async function syncProviderArticleBlocks('));
  const locks = sharedLocks(); let manifest = {}, indices = 0, lists = 0;
  const entry = { id_proveedor: '12', proveedor: 'Proveedor', version: 2 };
  const tabs = [];
  for (let i = 0; i < 2; i++) {
    const box = { navigator: { locks }, cleanId: String,
      openListDb: async () => ({ transaction: () => ({ objectStore: () => ({ get() { const request = {}; setImmediate(() => { request.result = { manifest }; request.onsuccess(); }); return request; } }) }) }),
      localProviderJsonManifest: meta => meta.manifest,
      readProviderArticlesCacheByProvider: async () => [{ codigo: '1' }],
      fetch: async () => { indices++; return { ok: true, json: async () => ({ providers: { 12: entry } }) }; },
      syncSingleProviderJson: async () => { lists++; await flush(); manifest = { 12: entry }; return [{ codigo: '1' }]; }
    };
    vm.createContext(box); vm.runInContext(code + '\nglobalThis.notice = syncProviderNotice;', box); tabs.push(box);
  }
  await Promise.all(tabs.map(box => box.notice({ providerId: '12', version: 2, manifestUrl: 'test' })));
  assert.equal(indices, 1); assert.equal(lists, 1);
});

test('el ranking conserva una versión que llega mientras descarga la anterior', async () => {
  const source = read('pedidos.html').match(/<script id="pedidos-ranking-script">([\s\S]*?)<\/script>/)[1];
  const code = source.slice(source.indexOf('  let pendingRankingMeta = null;'), source.indexOf('  function displayArticle('));
  let finishFirst, startedFirst; const started = new Promise(resolve => { startedFirst = resolve; });
  const downloads = [], box = { console, navigator: { locks: sharedLocks() }, syncPromise: null, state: { version: 0, rows: [] }, byId: new Map(), CACHE_KEY: 'ranking',
    cacheDb: { get: async () => null, set: async () => {} }, fetchMeta: async () => ({ ranking_version: 1 }), refreshVisible() {},
    fetchChanges: async (after, target) => { downloads.push(target); if (target === 1) { startedFirst(); await new Promise(resolve => { finishFirst = resolve; }); } return [{ idart: '1' }]; }
  };
  vm.createContext(box); vm.runInContext(code + '\nglobalThis.update = sync;', box);
  const first = box.update({ ranking_version: 1 }); await started;
  box.update({ ranking_version: 2 }); finishFirst(); await first; await flush();
  assert.equal(box.state.version, 2); assert.deepEqual(downloads, [1, 2]);
});

test('el ranking toma el aviso nuevo si llega mientras espera la versión inicial', async () => {
  const source = read('pedidos.html').match(/<script id="pedidos-ranking-script">([\s\S]*?)<\/script>/)[1];
  const code = source.slice(source.indexOf('  let pendingRankingMeta = null;'), source.indexOf('  function displayArticle('));
  let finishMeta, startedMeta; const started = new Promise(resolve => { startedMeta = resolve; });
  const downloads = [], box = { console, navigator: { locks: sharedLocks() }, syncPromise: null, state: { version: 0, rows: [] }, byId: new Map(), CACHE_KEY: 'ranking',
    cacheDb: { get: async () => null, set: async () => {} }, refreshVisible() {},
    fetchMeta: () => { startedMeta(); return new Promise(resolve => { finishMeta = resolve; }); },
    fetchChanges: async (after, target) => { downloads.push(target); return [{ idart: '1' }]; }
  };
  vm.createContext(box); vm.runInContext(code + '\nglobalThis.update = sync;', box);
  const first = box.update(); await started;
  box.update({ ranking_version: 2 }); finishMeta({ ranking_version: 1 }); await first; await flush();
  assert.equal(box.state.version, 2); assert.deepEqual(downloads, [2]);
});

test('ambos inicializadores Firebase reutilizan una app con nombre sin exigir DEFAULT', () => {
  const matches = [...read('corralon-system.js').matchAll(/const app = appModule\.getApps\(\)\.find\([\s\S]*?initializeApp\(FIREBASE_CONFIG, 'corralon-shared'\);/g)];
  assert.equal(matches.length, 2);
  for (const match of matches) {
    for (const scenario of ['named', 'empty', 'other']) {
      let created = 0;
      const named = { name: 'con-nombre', options: { projectId: 'corralon-progreso' } };
      const box = { FIREBASE_CONFIG: { projectId: 'corralon-progreso' }, appModule: {
        getApps: () => scenario === 'named' ? [named] : scenario === 'other' ? [{ name: '[DEFAULT]', options: { projectId: 'otro' } }] : [],
        getApp() { assert.fail('no debe asumir DEFAULT'); }, initializeApp(options, name) { created++; return { options, name }; }
      } };
      vm.createContext(box); vm.runInContext(match[0] + '\nglobalThis.selected = app;', box);
      assert.equal(created, scenario === 'named' ? 0 : 1); assert.equal(box.selected.options.projectId, 'corralon-progreso');
    }
  }
});
