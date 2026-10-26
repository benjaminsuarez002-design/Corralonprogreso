const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
const start = html.indexOf('async function restoreLastLocalState(){');
const end = html.indexOf('function persistCurrentState(){', start);
assert.ok(start >= 0 && end > start, 'Debe existir la restauración local');
const restoration = html.slice(start, end);

test('en una PC que abre la página por IP genera un GUID sin crypto.randomUUID', () => {
  const from = html.indexOf('function newDraftId(){');
  const to = html.indexOf('function fiscalQrPayload(', from);
  assert.ok(from >= 0 && to > from);
  const context = { crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, Uint8Array };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  const first = context.newDraftId();
  const second = context.newDraftId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});

function setup({ sqlConfig, drafts, activeId = '' }) {
  const applied = [];
  const badge = { textContent: '' };
  const messages = [];
  const context = {
    sqlConfig,
    localDraftStoreReady: false, restoreDraftPromise:null, draftViewRevision:0, draftId:'', issuedReceipt:null, issueInProgress:false, saleIds:[activeId],saleIndex:0,
    activeDraftId:()=>activeId,draftMatchesWorkstation:()=>true,
    ACTIVE_DRAFT_KEY: 'active',
    allDrafts: async () => drafts,
    importServerDrafts: async () => {},
    prepareRestoredDraft: async draft => draft,
    applyData: draft => applied.push(draft),
    refreshPendingButton: async () => {},
    updateTrialButton: () => {},
    localStorage: { getItem: () => activeId },
    $: () => badge,
    setMsg: (...args) => messages.push(args),
  };
  vm.createContext(context);
  vm.runInContext(restoration, context);
  return { context, applied, badge, messages };
}

test('F5 con SQL caído conserva el borrador sin aplicar ni sobrescribir campos incompletos', async () => {
  const state = setup({ sqlConfig: null, drafts: [{ id: 'venta-pendiente', recoveryPending: true }] });
  await state.context.restoreLastLocalState();
  assert.equal(state.applied.length, 0);
  assert.equal(state.context.localDraftStoreReady, true);
  assert.match(state.badge.textContent, /guardado localmente/);
  assert.match(state.messages[0][0], /sigue guardada/);
});

test('si se borró IndexedDB, importa la copia cifrada que entrega el servicio local', async () => {
  const from = html.indexOf('async function importServerDrafts(){');
  const to = html.indexOf('async function restoreLastLocalState(){', from);
  assert.ok(from >= 0 && to > from);
  const saved = [];
  const draft = { id: '8d2bae3d-01e4-4488-b07a-0e760481858d', articulos: [{}], valores: [{}] };
  const context = {
    SQL_PREPARACION: 'http://localhost:8081',
    ACTIVE_DRAFT_KEY: 'active',
    localStorage: { getItem: () => draft.id }, activeDraftId:()=>draft.id,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, borradores: [{ comprobante: draft }] }) }),
    allDrafts: async () => [],
    putDraft: async value => saved.push(value),
    console,
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  await context.importServerDrafts();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, draft.id);
  assert.equal(saved[0].recoveryPending, true);
});

test('una PC nueva no importa la venta pendiente de otro puesto', async () => {
  const from = html.indexOf('async function importServerDrafts(){');
  const to = html.indexOf('async function restoreLastLocalState(){', from);
  const saved = [];
  const draft = { id: '8d2bae3d-01e4-4488-b07a-0e760481858d', articulos: [{}], valores: [{}] };
  const context = {
    SQL_PREPARACION: 'http://localhost:8081', ACTIVE_DRAFT_KEY: 'active',
    localStorage: { getItem: () => '' }, activeDraftId:()=>'',
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, borradores: [{ comprobante: draft }] }) }),
    allDrafts: async () => [], putDraft: async value => saved.push(value), console,
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  await context.importServerDrafts();
  assert.equal(saved.length, 0);
});

test('al volver SQL se restaura la venta activa aunque otra haya cambiado después', async () => {
  const drafts = [{ id: 'otra-venta' }, { id: 'venta-activa', recoveryPending: true }];
  const state = setup({ sqlConfig: {}, drafts, activeId: 'venta-activa' });
  await state.context.restoreLastLocalState();
  assert.equal(state.applied.length, 1);
  assert.equal(state.applied[0].id, 'venta-activa');
});

test('F5 tras confirmar deja el formulario vacío y no carga otro presupuesto pendiente',async()=>{
 const invoice={id:'factura-morfil',estado:'emitido',emision:{idRecibo:499708,numero:'0006-00017639'},articulos:[{idart:'000004'}]};
 const other={id:'otro-presupuesto',recoveryPending:true,articulos:[{idart:'000056'}]};
 const state=setup({sqlConfig:{},activeId:invoice.id,drafts:[other,invoice]});
 await state.context.restoreLastLocalState();
 assert.deepEqual(state.applied,[null]);assert.equal(invoice.emision.numero,'0006-00017639');
});

test('F5 sin venta activa o con referencia perdida nunca elige el borrador más reciente',async()=>{
 for(const activeId of ['', 'referencia-no-encontrada']){
  const state=setup({sqlConfig:{},activeId,drafts:[{id:'ajeno-reciente',recoveryPending:true}]});
  await state.context.restoreLastLocalState();assert.deepEqual(state.applied,[null]);
 }
});

test('F5 no toma una venta de otro puesto ni una reservada en otra posición',async()=>{
 const draft={id:'otra-venta'};
 const wrongPoint=setup({sqlConfig:{},activeId:draft.id,drafts:[draft]});wrongPoint.context.draftMatchesWorkstation=()=>false;
 await wrongPoint.context.restoreLastLocalState();assert.deepEqual(wrongPoint.applied,[null]);
 const otherSlot=setup({sqlConfig:{},activeId:draft.id,drafts:[draft]});otherSlot.context.saleIds=['',draft.id];
 await otherSlot.context.restoreLastLocalState();assert.deepEqual(otherSlot.applied,[null]);
});

test('respuesta tardía de SQL no reemplaza lo que el vendedor empezó a cargar',async()=>{
 const state=setup({sqlConfig:{},activeId:'activa',drafts:[{id:'activa'}]});let release;
 state.context.prepareRestoredDraft=()=>new Promise(resolve=>{release=resolve});
 const loading=state.context.restoreLastLocalState();while(!release)await Promise.resolve();
 state.context.draftViewRevision++;release({id:'activa'});await loading;assert.equal(state.applied.length,0);
});

test('venta marcada emitida sin comprobante local también deja el formulario vacío',async()=>{
 const state=setup({sqlConfig:{},activeId:'activa',drafts:[{id:'activa',estado:'emitido'}]});
 await state.context.restoreLastLocalState();assert.deepEqual(state.applied,[null]);
});

test('la referencia de esta pestaña prevalece sobre la de otra y una venta vacía sigue vacía',()=>{
 const code=html.slice(html.indexOf('function activeDraftId(){'),html.indexOf('function rememberActiveDraft('));
 for(const [tab,expected] of [['mi-venta','mi-venta'],['',''],[null,'otra-pestaña']]){
  const ctx={sessionStorage:{getItem:()=>tab},localStorage:{getItem:()=> 'otra-pestaña'},ACTIVE_DRAFT_KEY:'active'};
  vm.runInNewContext(code,ctx);assert.equal(ctx.activeDraftId(),expected);
 }
});

test('PRES. ESPECIAL sin marca en SQL habilita reintentar el mismo borrador', async () => {
  const from = html.indexOf('async function verifyRecovery(');
  const to = html.indexOf('async function reconcileBackgroundPending(', from);
  assert.ok(from >= 0 && to > from);
  const requests = [];
  const messages = [];
  const context = {
    recoveryPending: true, recoveryCanRetry: false, draftId: '8d2bae3d-01e4-4488-b07a-0e760481858d',
    SQL_PREPARACION: '/api/facturacion',
    $: () => ({ value: '13' }),
    fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => ({ ok: true, estado: 'reintentable' }) };
    },
    setRecoveryAlert: message => messages.push(message),
    renderRecoveryResult: () => {},
    lockIssued: () => {},
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  await context.verifyRecovery();
  assert.equal(context.recoveryCanRetry, true);
  assert.match(requests[0], /tipo=13/);
  assert.match(messages.at(-1), /mismo borrador/);
});

test('la comprobación previa distingue SQL disponible de SQL caído', async () => {
  const from = html.indexOf('async function sqlConnectionAvailable(){');
  const to = html.indexOf('async function loadTicketPrinters(', from);
  assert.ok(from >= 0 && to > from);
  let available = true;
  const context = {
    SQL_PREPARACION: '/api/facturacion',
    AbortSignal,
    fetch: async () => available
      ? { ok: true, json: async () => ({ ok: true }) }
      : { ok: false },
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  assert.equal(await context.sqlConnectionAvailable(), true);
  available = false;
  assert.equal(await context.sqlConnectionAvailable(), false);
  context.fetch = async () => { throw new Error('red caída'); };
  assert.equal(await context.sqlConnectionAvailable(), false);
});

test('pegar pagos no crea otra fila cuando ya no queda diferencia', () => {
  const from = html.indexOf('function pastePaymentTable(');
  const to = html.indexOf('function bindStrictFormatting(){', from);
  assert.ok(from >= 0 && to > from);
  const payments = [{ tipo: 'Efectivo', importe: 50 }];
  const context = {
    $: () => ({ _selectionController: { getSelectedCells: () => [] } }),
    commitPaymentEdit: () => {},
    payments,
    totals: () => ({ difference: 0 }),
    reconcilePaymentRows: () => {},
    renderPayments: () => {},
    scheduleDraft: () => {},
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  const cell = { closest: () => ({ dataset: { row: '1', col: '0' } }) };
  assert.equal(context.pastePaymentTable('Efectivo\t10', cell), true);
  assert.equal(context.payments.length, 1);
});
