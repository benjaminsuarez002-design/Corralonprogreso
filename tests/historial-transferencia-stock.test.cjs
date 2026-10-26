const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('historial.html','utf8');
const code=html.slice(html.indexOf('let _transferenciaStockAbriendo = false;'),html.indexOf('function remitoSqlPendingKey('));
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
function setup({lostReply=false}={}){
 const dom=new JSDOM('',{url:'http://localhost:8080/historial.html',runScripts:'outside-only'}),w=dom.window,calls=[],messages=[],animations=[],resolved=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 w._detalleTipoActual='presupuesto';w._presupuestoDetalleActual={id:'budget-123',numero:'0001-00123',sucursal:'Progreso',items:[{codigo:'10',cantidad:10},{codigo:'000010',cantidad:2},{idart:'000011',cantidad:3}]};
 w.resolverRemitoCargadoSql=async(r,t)=>resolved.push({id:r.id,type:t});w.cargaSqlDisponible=()=>true;w.CorralonFunciones={animacionCarga:(...args)=>animations.push(args),menuSessionUser:()=>({id:'Benja',idOperador:1})};w.CorralonSystem={normalizeBranch:v=>v};w.esc=String;w.toast=message=>messages.push(message);
 let moves=0,applied=0,cancelled=false,partial=false;
 w.fetch=async(url,options)=>{
  if(options?.method==='POST'){
   const payload=JSON.parse(options.body);calls.push(payload);assert.ok(w.localStorage.getItem('corralon_historial_transferencia_sql_v1:budget-123'));
   if(!moves)applied++;moves=1;if(lostReply){lostReply=false;throw Error('Respuesta perdida')}
   return{ok:true,json:async()=>({ok:true,idRecibo:111,numeroMovimiento:222})};
  }
  if(String(url).includes('estado-origen'))return{ok:true,json:async()=>({ok:true,vigente:moves>0||partial,cargado:moves>0&&!partial,bloqueado:partial,puedeRecargar:!moves&&!partial,hayAnterior:cancelled,resultado:moves?{idRecibo:111,numeroMovimiento:222,sucursal:1}:null,mensaje:'Queda un movimiento vigente'})};
  return{ok:true,json:async()=>({ok:true,proveedorTransferencia:5963,sucursales:[{id:1,nombre:'Progreso'},{id:2,nombre:'Calle 5'}],puntosVenta:[{id:7,idSucursal:1},{id:8,idSucursal:2}],tiposMovimiento:[{id:57,nombre:'Transferencia Stock'}]})};
 };
 w.eval(code);return{dom,w,calls,messages,animations,resolved,moves:()=>moves,applied:()=>applied,cancel:()=>{moves=0;cancelled=true},partial:()=>{moves=0;partial=true}};
}
test('botón entre copiar y eliminar; usa los renglones del presupuesto y agrupa IDArt repetido',()=>{
 assert.ok(html.indexOf('id="btnDetalleCopy"')<html.indexOf('id="btnDetalleTransferStock"'));assert.ok(html.indexOf('id="btnDetalleTransferStock"')<html.indexOf('id="btnDetalleDel"'));
 const s=setup();try{
  const rows=s.w.transferenciaPresupuestoItems(s.w._presupuestoDetalleActual);assert.equal(rows.length,2);assert.equal(rows[0].idart,'000010');assert.equal(rows[0].cantidad,12);
  assert.throws(()=>s.w.transferenciaPresupuestoItems({items:[{codigo:'10',cantidad:0}]}),/cantidad/);
  assert.throws(()=>s.w.transferenciaPresupuestoItems({items:[{codigo:'',cantidad:1}]}),/código/);
  assert.throws(()=>s.w.transferenciaPresupuestoItems({items:[{codigo:'10',cantidad:100001}]}),/rango/);
 }finally{s.dom.window.close()}
});
test('origen y destino se invierten automáticamente, y confirmar envía una sola transferencia',async()=>{
 const s=setup();try{
  const original=JSON.stringify(s.w._presupuestoDetalleActual);
  await s.w.abrirTransferenciaPresupuestoSql();const d=s.w.document,origin=d.querySelector('[data-transfer-origin]'),destination=d.querySelector('[data-transfer-destination]');
  assert.equal(d.querySelector('[data-transfer-type]').value,'57');assert.equal(origin.value,'1');assert.equal(destination.value,'2');assert.equal(destination.disabled,true);
  origin.value='2';origin.dispatchEvent(new s.w.Event('change'));assert.equal(destination.value,'1');
  d.querySelector('[data-transfer-save]').click();d.querySelector('[data-transfer-save]').click();await tick();assert.equal(s.calls.length,1);
  const payload=s.calls[0];assert.equal(payload.accion,'transferir-presupuesto');assert.equal(payload.sucursal,2);assert.equal(payload.sucursalDestino,1);assert.equal(payload.puntoVenta,8);assert.equal(payload.tipoMovimiento,57);assert.equal(payload.proveedor,5963);assert.equal(payload.numeroRemito,'0001-00123');assert.equal(payload.numeroFactura,'');assert.equal(payload.articulos[0].cantidad,12);
  assert.equal(JSON.stringify(s.w._presupuestoDetalleActual),original);assert.equal(d.querySelector('dialog'),null);assert.deepEqual(s.animations.map(a=>a[0]),['syncing','success']);assert.equal(s.resolved[0].type,'presupuesto');
  await s.w.abrirTransferenciaPresupuestoSql();assert.equal(d.querySelector('[data-transfer-save]').textContent,'Marcar como resuelto');
 }finally{s.dom.window.close()}
});
test('respuesta perdida conserva los datos exactos al cerrar, reabrir y reintentar',async()=>{
 const s=setup({lostReply:true});try{
  await s.w.abrirTransferenciaPresupuestoSql();const d=s.w.document;d.querySelector('[data-transfer-save]').click();await tick();assert.match(d.querySelector('[data-transfer-status]').textContent,/Respuesta perdida/);
  d.querySelector('[data-transfer-close]').click();await s.w.abrirTransferenciaPresupuestoSql();assert.equal(d.querySelector('[data-transfer-origin]').disabled,true);
  s.w._presupuestoDetalleActual.items[0].cantidad=999;
  d.querySelector('[data-transfer-save]').click();await tick();assert.equal(s.calls.length,1);assert.equal(s.moves(),1);assert.equal(d.querySelector('dialog'),null);
 }finally{s.dom.window.close()}
});
test('cerrar sin confirmar no mueve stock, y la opción no abre desde el sitio público ni desde remitos',async()=>{
 const s=setup();try{
  await s.w.abrirTransferenciaPresupuestoSql();s.w.document.querySelector('[data-transfer-close]').click();assert.equal(s.calls.length,0);
  s.w.cargaSqlDisponible=()=>false;await s.w.abrirTransferenciaPresupuestoSql();assert.equal(s.w.document.querySelector('dialog'),null);
  s.w.cargaSqlDisponible=()=>true;s.w._detalleTipoActual='remito';await s.w.abrirTransferenciaPresupuestoSql();assert.equal(s.w.document.querySelector('dialog'),null);
 }finally{s.dom.window.close()}
});

test('anular en SQL rehabilita la transferencia aunque la copia local diga confirmada',async()=>{
 const s=setup();try{
  await s.w.abrirTransferenciaPresupuestoSql();const d=s.w.document;d.querySelector('[data-transfer-save]').click();await tick();s.cancel();
  await s.w.abrirTransferenciaPresupuestoSql();assert.equal(d.querySelector('[data-transfer-save]').disabled,false);assert.equal(d.querySelector('[data-transfer-origin]').disabled,false);
  d.querySelector('[data-transfer-save]').click();await tick();assert.equal(s.applied(),2);assert.equal(s.calls.length,2);
 }finally{s.dom.window.close()}
});
test('anulación parcial o fallo al comprobar SQL no permite duplicar',async()=>{
 const s=setup();try{
  s.partial();await s.w.abrirTransferenciaPresupuestoSql();assert.equal(s.w.document.querySelector('dialog'),null);assert.match(s.messages.at(-1),/vigente/);assert.equal(s.calls.length,0);
  s.w.fetch=async()=>{throw Error('SQL desconectado')};await s.w.abrirTransferenciaPresupuestoSql();assert.equal(s.w.document.querySelector('dialog'),null);assert.equal(s.calls.length,0);
 }finally{s.dom.window.close()}
});

