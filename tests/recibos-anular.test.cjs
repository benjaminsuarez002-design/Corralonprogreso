const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../respaldo/recibos-cobro.html'),'utf8');
function setup(admin=true){
 const dom=new JSDOM('<dialog id="receiptModal"></dialog><div id="receiptPrint"></div><div id="receiptTitle"></div><div id="receiptBody"></div><button id="voidReceipt"></button><button id="printReceipt"></button><p id="receiptStatus"></p><dialog id="historyModal" open></dialog>');
 const calls=[],receipt={id:120,numero:'0010-00000120',idCliente:42,total:600000,anulado:false};
 const s={options:{pagos:[{id:6,nombre:'Transf Bria.',clase:3},{id:7,nombre:'Transf prov',clase:3},{id:1,nombre:'Efectivo',clase:1}],tarjetas:[{id:4,nombre:'MP Transferencia'}]},document:dom.window.document,admin,user:{id:'admin'},viewedReceipt:null,cancellingReceipt:false,busy:false,confirmed:{...receipt},customer:42,approve:true,fail:false,hold:null,
  esc:v=>String(v??''),money:v=>String(v),renderReceiptPrint:()=>'',lock:()=>{},status:()=>{},receiptAdmin:()=>s.admin,confirm:()=>s.approve,
  history:async()=>calls.push('history'),refreshBalance:async()=>calls.push('balance'),
  api:async(p,b)=>{calls.push(b);if(s.hold)await s.hold;if(s.fail)throw Error('La Caja está cerrada');return {version:'v2',recibo:{...receipt,anulado:true},facturas:[],valores:[]};}};
 s.$=id=>s.document.getElementById(id);s.$('receiptModal').showModal=function(){this.open=true};
 vm.createContext(s);vm.runInContext(html.slice(html.indexOf('  async function showReceipt('),html.indexOf('  async function confirmReceipt(')),s);
 return {s,calls,receipt,dom,open:()=>s.showReceipt(120,{version:'v1',recibo:receipt,facturas:[],valores:[]})};
}
test('solo administradores ven la acción y un lector no puede invocar la anulación',async()=>{
 const t=setup(false);try{await t.open();assert.equal(t.s.$('voidReceipt').hidden,true);await t.s.cancelViewedReceipt();assert.equal(t.calls.length,0);}finally{t.dom.window.close();}
});
test('cancelar la confirmación no envía ninguna escritura',async()=>{
 const t=setup();try{await t.open();assert.equal(t.s.$('voidReceipt').hidden,false);t.s.approve=false;await t.s.cancelViewedReceipt();assert.equal(t.calls.length,0);}finally{t.dom.window.close();}
});
test('anula con versión y actualiza detalle, impresión, historial y saldo; no permite anular de nuevo',async()=>{
 const t=setup();try{await t.open();await t.s.cancelViewedReceipt();assert.equal(t.calls[0].accion,'anular');assert.equal(t.calls[0].id,120);assert.equal(t.calls[0].version,'v1');assert.equal(t.calls[0].usuarioId,'admin');assert.equal(t.s.confirmed.anulado,true);assert.match(t.s.$('receiptTitle').textContent,/ANULADO/);assert.equal(t.s.$('voidReceipt').hidden,true);assert.deepEqual(t.calls.slice(1),['history','balance']);await t.s.cancelViewedReceipt();assert.equal(t.calls.length,3);}finally{t.dom.window.close();}
});
test('si SQL rechaza la anulación conserva el recibo y permite reintentar',async()=>{
 const t=setup();try{await t.open();t.s.fail=true;await t.s.cancelViewedReceipt();assert.equal(t.s.viewedReceipt.recibo.anulado,false);assert.equal(t.s.$('voidReceipt').hidden,false);assert.equal(t.s.$('voidReceipt').disabled,false);assert.equal(t.s.busy,false);assert.match(t.s.$('receiptStatus').textContent,/Caja está cerrada/);assert.equal(t.calls.length,1);}finally{t.dom.window.close();}
});
test('doble clic no duplica la solicitud',async()=>{
 const t=setup();try{await t.open();let release;t.s.hold=new Promise(r=>release=r);const pending=t.s.cancelViewedReceipt();await t.s.cancelViewedReceipt();assert.equal(t.calls.length,1);release();await pending;}finally{t.dom.window.close();}
});
test('los scripts del formulario conservan sintaxis válida',()=>{for(const block of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(block[1]);});

test('administrador cambia tipo de pago con version sin enviar importes ni boletas',async()=>{
 const t=setup();try{await t.s.showReceipt(120,{version:'v1',recibo:t.receipt,facturas:[{id:1,numero:'X',importe:600000}],valores:[{orden:44,idTipoPago:7,tipo:'Transf prov',clase:3,idTarjeta:4,cuotas:0,importe:600000}]});t.s.editViewedReceiptPayment();const q=s=>t.s.$('receiptBody').querySelector(s);assert.equal(q('[data-edit-type]').value,'7');q('[data-edit-type]').value='6';q('[data-edit-type]').dispatchEvent(new t.dom.window.Event('change'));await q('[data-save-payment]').onclick();const body=t.calls[0];assert.equal(body.accion,'editar-pago');assert.equal(body.orden,44);assert.equal(body.tipo,6);assert.equal(body.tarjeta,4);assert.equal(body.version,'v1');assert.equal('importe'in body,false);assert.equal('facturas'in body,false);assert.match(t.s.$('receiptStatus').textContent,/actualizado/);}finally{t.dom.window.close()}
});

test('lector no abre editor ni envia cambios y rechazo SQL conserva datos para corregir',async()=>{
 const reader=setup(false);try{await reader.open();reader.s.editViewedReceiptPayment();assert.equal(reader.s.$('receiptBody').querySelector('[data-payment-editor]'),null);assert.equal(reader.calls.length,0);}finally{reader.dom.window.close()}
 const t=setup();try{await t.s.showReceipt(120,{version:'v1',recibo:t.receipt,facturas:[],valores:[{orden:44,idTipoPago:7,tipo:'Transf prov',clase:3,idTarjeta:4,cuotas:0,importe:600000}]});t.s.editViewedReceiptPayment();t.s.fail=true;await t.s.$('receiptBody').querySelector('[data-save-payment]').onclick();assert.match(t.s.$('receiptStatus').textContent,/Caja está cerrada/);assert.equal(t.s.viewedReceipt.valores[0].importe,600000);assert.equal(t.s.$('receiptBody').querySelector('[data-save-payment]').disabled,false);}finally{t.dom.window.close()}
});
test('cerrar el recibo recién emitido inicia otro y cerrar una consulta conserva el borrador',async()=>{
 const t=setup();try{
  const {s}=t;
  for(const id of ['cancel','point','number','balance','note','date'])s.document.body.insertAdjacentHTML('beforeend',`<input id="${id}">`);
  Object.assign(s,{pending:null,invoices:[{id:9}],invoiceChoices:[{id:9}],values:[{importe:600000}],requestSequence:2,selectedInvoice:0,
   billingDefaultPoint:()=>10,blankValue:()=>({importe:0}),syncCustomer:()=>{},dateText:()=> '17/10/2026',today:()=>'',key:()=> 'draft',render:()=>{},save:()=>{},localStorage:{removeItem:()=>{}}});
  const resetStart=html.indexOf('  function startNewReceipt(){'),resetEnd=html.indexOf("  $('historyBody').addEventListener",resetStart);
  vm.runInContext(html.slice(resetStart,resetEnd),s);
  await t.open();s.$('receiptModal').dispatchEvent(new t.dom.window.Event('close'));
  assert.equal(s.confirmed,null);assert.equal(s.customer,0);assert.equal(s.invoices.length,0);assert.equal(s.values.length,1);assert.equal(s.values[0].importe,0);assert.equal(s.$('number').value,'');assert.equal(s.$('point').value,'10');
  s.customer=42;s.invoices=[{id:88}];s.$('note').value='Borrador en curso';
  await t.open();s.$('receiptModal').dispatchEvent(new t.dom.window.Event('close'));
  assert.equal(s.customer,42);assert.equal(s.invoices[0].id,88);assert.equal(s.$('note').value,'Borrador en curso');
 }finally{t.dom.window.close();}
});

