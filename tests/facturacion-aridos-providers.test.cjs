const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('../.codex-staging/importer-dom-test/node_modules/jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
const source = html.slice(html.indexOf('function saleNeedsAridosDelivery('), html.indexOf('async function saveAridosDeliveryState('));
const sale = { idComprobante: 13, articulos: [{ idart: '000512', cantidad: 10, descripcion: 'ARENA FINA', costoFinal: 100 }] };

function setup(failSync = false) {
  const dom = new JSDOM('<body></body>');
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  let checks = 0;
  const context = vm.createContext({
    document: dom.window.document, aridosEntrega: null, n: Number, esc: String,
    CorralonSystem: {
      aridos: { loadCachedConfig: async () => ({ available: true }), getConfig: () => ({ activo: true }) },
      getProvidersCache: async () => { throw new Error('No debe utilizar directamente la cache vieja de esta PC'); },
      syncProvidersCache: async () => {
        checks++;
        if (failSync) throw new Error('No se pudo consultar la version de proveedores');
        return [{ id_proveedor: 'web-galdeano', codigo_proveedor: '6072', proveedor: 'ARIDOS GALDEANO' }];
      },
      providerIdentity: { externalId: p => p.codigo_proveedor }
    }
  });
  vm.runInContext(source, context);
  return { dom, context, checks: () => checks };
}

test('consulta la version compartida antes de buscar y seleccionar el proveedor del arido', async () => {
  const s = setup();
  try {
    const result = s.context.chooseAridosDelivery(sale);
    await new Promise(resolve => setImmediate(resolve));
    const field = s.dom.window.document.querySelector('[data-delivery-provider]');
    field.value = 'galde';
    field.dispatchEvent(new s.dom.window.Event('input'));
    const option = s.dom.window.document.querySelector('[data-delivery-option]');
    assert.match(option.textContent, /ARIDOS GALDEANO.*6072/);
    option.click();
    s.dom.window.document.querySelector('[data-delivery-confirm]').click();
    const chosen = await result;
    assert.equal(chosen.provider.sqlId, 6072);
    assert.equal(chosen.provider.id_proveedor, 'web-galdeano');
    assert.equal(s.checks(), 1);
  } finally { s.dom.window.close(); }
});

test('si falla la sincronizacion no presenta una lista vieja como si estuviera actualizada', async () => {
  const s = setup(true);
  try {
    await assert.rejects(s.context.chooseAridosDelivery(sale), /version de proveedores/);
    assert.equal(s.dom.window.document.querySelector('dialog'), null);
  } finally { s.dom.window.close(); }
});

test('áridos queda preseleccionado y permite confirmar sin buscar', async()=>{
  const s=setup();try{const pending=s.context.chooseAridosDelivery(sale);await new Promise(resolve=>setImmediate(resolve));assert.match(s.dom.window.document.querySelector('[data-delivery-provider]').value,/GALDEANO/);s.dom.window.document.querySelector('[data-delivery-confirm]').click();assert.equal((await pending).provider.sqlId,6072);}finally{s.dom.window.close();}
});
test('ladrillones preselecciona Ariel y conserva un proveedor elegido anteriormente',async()=>{
  const s=setup();s.context.CorralonSystem.aridos.getConfig=()=>({activo:false,tipo:'ladrillones'});
  s.context.CorralonSystem.syncProvidersCache=async()=>[{id_proveedor:'ariel',codigo_proveedor:'123',proveedor:'ARIEL LADRILLONES'},{id_proveedor:'otro',codigo_proveedor:'456',proveedor:'OTRO PROVEEDOR'}];
  try{let pending=s.context.chooseAridosDelivery(sale);await new Promise(resolve=>setImmediate(resolve));assert.match(s.dom.window.document.querySelector('[data-delivery-provider]').value,/ARIEL LADRILLONES/);s.dom.window.document.querySelector('[data-delivery-confirm]').click();assert.equal((await pending).provider.sqlId,123);
  s.context.aridosEntrega={provider:{id_proveedor:'otro'}};pending=s.context.chooseAridosDelivery(sale);await new Promise(resolve=>setImmediate(resolve));assert.match(s.dom.window.document.querySelector('[data-delivery-provider]').value,/OTRO PROVEEDOR/);s.dom.window.document.querySelector('[data-delivery-confirm]').click();assert.equal((await pending).provider.sqlId,456);
  }finally{s.dom.window.close();}
});

test('venta mixta pide ambos proveedores y separa los articulos, sin mezclar materiales comunes',async()=>{
 const s=setup();s.context.CorralonSystem.aridos.getConfig=id=>id==='brick'?{tipo:'ladrillones'}:id==='000512'?{activo:true}:{};
 s.context.CorralonSystem.syncProvidersCache=async()=>[{id_proveedor:'galdeano',codigo_proveedor:'6072',proveedor:'ARIDOS GALDEANO'},{id_proveedor:'ariel',codigo_proveedor:'123',proveedor:'ARIEL LADRILLONES'}];
 try{const pending=s.context.chooseAridosDelivery({...sale,articulos:[...sale.articulos,{idart:'brick',cantidad:1000,descripcion:'LADRILLON',costoFinal:100},{idart:'other',cantidad:1,descripcion:'CEMENTO',costoFinal:10}]});await new Promise(resolve=>setImmediate(resolve));assert.match(s.dom.window.document.querySelector('h3').textContent,/áridos/);assert.match(s.dom.window.document.querySelector('[data-delivery-provider]').value,/GALDEANO/);s.dom.window.document.querySelector('[data-delivery-confirm]').click();await new Promise(resolve=>setImmediate(resolve));assert.match(s.dom.window.document.querySelector('h3').textContent,/ladrillones/);assert.match(s.dom.window.document.querySelector('[data-delivery-provider]').value,/ARIEL/);s.dom.window.document.querySelector('[data-delivery-confirm]').click();const result=await pending;assert.equal(result.groups.length,2);assert.equal(result.groups[0].provider.sqlId,6072);assert.equal(result.groups[0].items.length,1);assert.equal(result.groups[0].items[0].idart,'000512');assert.equal(result.groups[1].provider.sqlId,123);assert.equal(result.groups[1].items.length,1);assert.equal(result.groups[1].items[0].idart,'brick');}finally{s.dom.window.close()}
});

test('cancelar el segundo proveedor cancela la preparacion completa de la venta mixta',async()=>{
 const s=setup();s.context.CorralonSystem.aridos.getConfig=id=>id==='brick'?{tipo:'ladrillones'}:{activo:true};try{const pending=s.context.chooseAridosDelivery({...sale,articulos:[...sale.articulos,{idart:'brick',cantidad:10,descripcion:'LADRILLON',costoFinal:100}]});await new Promise(resolve=>setImmediate(resolve));s.dom.window.document.querySelector('[data-delivery-confirm]').click();await new Promise(resolve=>setImmediate(resolve));s.dom.window.document.querySelector('[data-delivery-cancel]').click();assert.equal(await pending,false);}finally{s.dom.window.close()}
});
