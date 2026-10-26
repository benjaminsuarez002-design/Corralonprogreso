const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const html = fs.readFileSync('respaldo/caja.html', 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!match[1].includes('src=') && match[2].trim()) new vm.Script(match[2]);
}
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const code = section('function userCashDocId(', 'function cajaManualPayload(')
  + section('function cajaCloudValueSignature(', 'function summaryManualPayload(');
const stored = new Map();
const docs = new Map();
const timers = new Map();
const writes = [];
const notices = [];
let nextTimer = 0;
let deferredRead;
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = key => ({ exists: docs.has(key), data: () => clone(docs.get(key)) });
const db = {
  collection: collection => ({ doc: id => ({ key: `${collection}|${id}`, get: async () => {
    if (deferredRead) return deferredRead;
    return snapshot(`${collection}|${id}`);
  } }) }),
  runTransaction: async callback => callback({
    get: async ref => snapshot(ref.key),
    set: (ref, value) => {
      docs.set(ref.key, { ...docs.get(ref.key), ...clone(value) });
      writes.push({ key: ref.key, value: clone(value) });
    }
  })
};
const context = {
  selectedDateKey: '2026-10-05', cashUserId: 'ana',
  cashUserLoadedKey: '', cashUserSnapshot: '', cashUserLoadSequence: 0,
  cashUserSaveTimers: new Map(), cashUserWritesInFlight: new Map(),
  firebaseCajaRemoteSnapshots: new Map(), firebaseCajaWriteChains: new Map(),
  applyingRemoteState: false, state: { cash: [] },
  CASH_DENOMS: [100, 200, 500, 1000, 2000, 10000, 20000],
  STORAGE_KEY_BASE: 'corralon_control_caja_v1',
  FIREBASE_CASH_USER_COLLECTION: 'control_caja_efectivo_usuario',
  localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
  firebaseDatabase: () => db,
  firebase: { firestore: { FieldValue: { serverTimestamp: () => 'timestamp' } } },
  renderCashRows() {}, updateTotals() {}, showToast: text => notices.push(text),
  setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
  clearTimeout: id => timers.delete(id)
};
vm.createContext(context);
vm.runInContext(code, context);
async function flush() {
  for (const [id, callback] of [...timers]) {
    timers.delete(id);
    await callback();
  }
}
const cashKey = (date, user) => `control_caja_efectivo_usuario|${date}__${user}`;
(async () => {
  stored.set('corralon_control_caja_v1_2026-10-05', JSON.stringify({ cash: [{ denom: 100, bills: 99 }] }));
  docs.set('control_caja_manual|2026-10-05', { cash: [{ denom: 100, bills: 99 }], transfers: [{ amount: 123 }] });
  const legacy = clone(docs.get('control_caja_manual|2026-10-05'));
  await context.loadUserCashState();
  assert.equal(context.state.cash[0].bills, 0);
  context.queueUserCashSave(); await flush();
  assert.equal(writes.length, 0, 'Carga sin edición no escribe');
  context.state.cash[0].bills = 3;
  context.persistUserCashLocal(); context.queueUserCashSave();
  context.selectedDateKey = '2026-10-04';
  await context.loadUserCashState();
  await flush();
  assert.equal(docs.get(cashKey('2026-10-05', 'ana')).cash[0].bills, 3);
  assert.equal(docs.get(cashKey('2026-10-05', 'ana')).fecha, '2026-10-05');
  assert.equal(context.state.cash[0].bills, 0, 'Guardado anterior no cambia la fecha visible');
  context.selectedDateKey = '2026-10-05'; context.cashUserId = 'bruno';
  context.loadUserCashLocal(); assert.equal(context.state.cash[0].bills, 0);
  await context.loadUserCashState();
  context.state.cash[0].bills = 8;
  context.persistUserCashLocal(); context.queueUserCashSave(); await flush();
  assert.equal(docs.get(cashKey('2026-10-05', 'bruno')).cash[0].bills, 8);
  context.cashUserId = 'ana'; context.loadUserCashLocal();
  assert.equal(context.state.cash[0].bills, 3, 'Cache separada por usuario');
  await context.loadUserCashState();
  context.state.cash[0].bills = 5; context.queueUserCashSave();
  context.state.cash[0].bills = 3; context.queueUserCashSave();
  const beforeRevert = writes.length;
  await flush(); assert.equal(writes.length, beforeRevert, 'Revertir cancela el guardado');
  docs.get(cashKey('2026-10-05', 'ana')).cash[0].bills = 7;
  context.state.cash[0].bills = 6; context.persistUserCashLocal(); context.queueUserCashSave();
  await flush();
  assert.equal(docs.get(cashKey('2026-10-05', 'ana')).cash[0].bills, 7, 'Conflicto no sobrescribe otra PC');
  assert.equal(context.state.cash[0].bills, 6);
  assert.equal(context.cashUserCanEdit(), false);
  assert(notices.some(text => text.includes('otra PC')));
  assert.deepEqual(docs.get('control_caja_manual|2026-10-05'), legacy, 'Conteo anterior y transferencias conservados');
  let resolveRead;
  deferredRead = new Promise(resolve => { resolveRead = resolve; });
  const pending = context.loadUserCashState();
  context.selectedDateKey = '2026-10-03'; context.loadUserCashLocal();
  resolveRead({ exists: true, data: () => ({ cash: [{ denom: 100, bills: 77 }] }) });
  await pending; deferredRead = null;
  assert.equal(context.state.cash[0].bills, 0, 'Lectura tardía no invade otra fecha');
  context.cashUserId = ''; await context.loadUserCashState();
  assert.equal(context.cashUserCanEdit(), false);
  console.log('PASS: sintaxis; usuario/fecha; carga sin escrituras; caché aislada; temporizador capturado; revertir; conflictos; lectura tardía; datos anteriores conservados.');
})().catch(error => { console.error(error); process.exitCode = 1; });
