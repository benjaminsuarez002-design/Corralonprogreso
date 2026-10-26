const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('gestion.html','utf8');
function setup(local=true){
 const dom=new JSDOM('<body><input id="customerName"><input id="docNumber"><button id="customerDrop"></button><div id="clientesSql"></div><select id="voucherType">'+[1,2,5,6,7,8,13,29,43].map(x=>`<option>${x}</option>`).join('')+'</select><select id="docType"><option>DNI</option><option>CUIT</option><option>Sin identificar</option></select><select id="customerTax"><option>Consumidor final</option><option>Responsable inscripto</option><option>Exento</option><option>Monotributista</option></select><input id="customerAddress"><input id="customerPhone"><input id="customerEmail"></body>',{url:'http://localhost:8080/gestion.html'});
 const w=dom.window,$=s=>w.document.querySelector(s),calls=[],timers=new Map();let timer=0;
 const customers=[{id:1,nombre:'CONSUMIDOR FINAL',idTipoIva:5,documento:'1000'}, {id:2,nombre:'ECHEGARAY',idTipoIva:1,idTipoDoc:67,documento:'30716304643'}, {id:3,nombre:'MUNICIPALIDAD',idTipoIva:4,idTipoDoc:67,documento:'30673246245'}, {id:4,nombre:'MONOTRIBUTO',idTipoIva:6,documento:'20300000001'}].map(x=>({...x,searchName:x.nombre.toLowerCase(),searchDoc:x.documento}));
 const ctx={document:w.document,window:w,$,customerCatalogReady:local,customerCatalog:customers,norm:x=>String(x||'').toLowerCase().trim(),esc:x=>String(x||''),customerUpper:x=>String(x).toUpperCase(),syncCustomerTaxShort(){},formatCuit:x=>x,refreshCustomerBalance:async()=>{},scheduleDraft(){},renderCustomerBalance(){},console,SQL_PREPARACION:'/api/facturacion',
 setTimeout:fn=>{timers.set(++timer,fn);return timer},clearTimeout:id=>timers.delete(id),fetch:async url=>{calls.push(url);return {ok:true,json:async()=>({ok:true,clientes:[]})}}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function customerAllowedForVoucher('),html.indexOf('let customerBalanceState=')),ctx);ctx.bindCustomerSearch();
 return{dom,w,$,ctx,calls,customers,open:()=>$('#customerName').dispatchEvent(new w.KeyboardEvent('keydown',{key:'F4',bubbles:true})),timers,flush:async()=>{const fns=[...timers.values()];timers.clear();for(const fn of fns)await fn()}};
}
test('B, NC B y ND B ocultan RI; A y comprobantes restantes conservan todos, incluidos exentos',()=>{
 const t=setup();try{for(const type of [1,2,5,6,7,8,13,29,43]){
  t.$('#voucherType').value=String(type);t.$('#voucherType').dispatchEvent(new t.w.Event('change'));t.open();
  const names=t.$('#clientesSql').textContent;assert.equal(names.includes('ECHEGARAY'),![2,6,8].includes(type));assert.match(names,/MUNICIPALIDAD/);assert.match(names,/MONOTRIBUTO/);assert.match(names,/CONSUMIDOR FINAL/);
 }}finally{t.dom.window.close()}
});
test('búsqueda por nombre y documento aplica el filtro; la Municipalidad se puede seleccionar en B con CUIT',()=>{
 const t=setup();try{
  t.$('#voucherType').value='2';t.$('#customerName').value='ECHEGARAY';t.open();assert.equal(t.$('#clientesSql').children.length,0);
  t.$('#docNumber').value='30716304643';t.$('#docNumber').dispatchEvent(new t.w.Event('input'));assert.equal(t.$('#clientesSql').children.length,0);
  t.$('#customerName').value='MUNICIPALIDAD';t.open();t.$('[data-client-index]').click();assert.equal(t.$('#customerName').dataset.idCliente,'3');assert.equal(t.$('#customerTax').value,'Exento');assert.equal(t.$('#docType').value,'CUIT');assert.equal(t.$('#docNumber').value,'30673246245');
 }finally{t.dom.window.close()}
});
test('consulta remota envía el tipo también al paginar y descarta respuestas del comprobante anterior',async()=>{
 const t=setup(false);try{
  t.$('#voucherType').value='2';t.$('#customerName').focus();
  t.ctx.fetch=async url=>{t.calls.push(url);return{ok:true,json:async()=>({ok:true,clientes:[{...t.customers[2],rn:1,total:100,firstMatch:1}]})}};
  t.open();await t.flush();assert.match(t.calls[0],/tipoComprobante=2/);
  t.$('#clientesSql').dispatchEvent(new t.w.Event('scroll'));await Promise.resolve();await Promise.resolve();assert.ok(t.calls.some(url=>url.includes('start=2')&&url.includes('tipoComprobante=2')));
  t.$('#voucherType').value='1';t.$('#voucherType').dispatchEvent(new t.w.Event('change'));
  let release;t.ctx.fetch=()=>new Promise(resolve=>{release=resolve});t.open();const pending=t.flush();
  t.$('#voucherType').value='2';t.$('#voucherType').dispatchEvent(new t.w.Event('change'));
  release({ok:true,json:async()=>({ok:true,clientes:[t.customers[1]]})});await pending;assert.equal(t.$('#clientesSql').classList.contains('open'),false);
 }finally{t.dom.window.close()}
});
