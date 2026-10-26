const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('gestion.html','utf8');
const begin=html.indexOf(' const modules={'),end=html.indexOf('\n const resources=',begin);
const source=JSON.parse(html.slice(begin+15,end).trim().replace(/;$/,'')).compras.html;
const block=source.slice(source.indexOf('  let freightSelection='),source.indexOf("  $('reportFilters').addEventListener",source.indexOf('  let freightSelection=')));
function setup(){
 const dom=new JSDOM('<button id="freightButton"></button>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 const rows=[{id:1,numero:'0001-1',proveedor:'Empresa',total:600000},{id:2,numero:'0001-2',proveedor:'Empresa',total:400000},{id:3,numero:'0002-3',proveedor:'Fletes',total:100000}];
 const stored=new Map();let writes=0;
 Object.assign(w,{TextEncoder,$:id=>w.document.getElementById(id),user:{id:'tester'},today:()=> '2026-10-26',money:n=>'$ '+Number(n).toFixed(2),decimal:n=>Number(n).toFixed(2).replace('.',','),currencyNumber:s=>Number(s.replace(/\./g,'').replace(',','.')),esc:v=>String(v??''),FX:{createUuid:()=> 'same-operation'},api:async()=>({facturas:rows,hayMas:false}),CorralonSystem:{getProvidersCache:async()=>[],providerIdentity:{resolveText:()=>null}}});
 w.eval(block+`;window.freightTest={selection:()=>freightSelection,pick:pickFreightInvoice,allocate:allocatePurchaseFreight,save:savePurchaseFreight,load:loadFreightInvoices,setDb:db=>{freightDbPromise=Promise.resolve(db)}};`);
 w.freightTest.setDb({db:{},doc:(_db,...parts)=>parts.join('/'),serverTimestamp:()=> 'now',runTransaction:async (_db,fn)=>fn({get:async ref=>({exists:()=>stored.has(ref),data:()=>stored.get(ref)}),set:(ref,value)=>{stored.set(ref,value);if(value.kind==='movement')writes++;}})});
 return {w,rows,stored,writes:()=>writes,close:()=>w.close(),choose:async kind=>{w.document.querySelector('[data-freight-choose="'+kind+'"]').click();await new Promise(r=>setImmediate(r));}};
}
test('selecciona varias facturas, conserva al buscar y reparte un unico flete',async()=>{const s=setup();try{
 await s.choose('invoice');s.w.freightTest.pick(0);s.w.freightTest.pick(1);
 assert.equal(s.w.document.getElementById('purchaseFreightPicker').open,true);
 await s.w.freightTest.load();assert.equal(s.w.document.querySelectorAll('[data-pick-freight]:checked').length,2);
 s.w.document.querySelector('[data-picker-use]').click();await s.choose('freight');s.w.freightTest.pick(2);
 assert.deepEqual(Array.from(s.w.freightTest.selection().allocations,x=>x.amount),[60000,40000]);
 await s.w.freightTest.save();assert.equal(s.writes(),1,s.w.document.getElementById('purchaseFreightStatus').textContent);
 const payload=[...s.stored.values()].find(x=>x.kind==='movement');assert.equal(payload.invoice,1000000);assert.equal(payload.freight,100000);assert.equal(payload.purchaseInvoices.length,2);
 }finally{s.close()}});
test('ajuste manual exige cerrar total y evita usar flete como mercaderia',async()=>{const s=setup();try{
 await s.choose('invoice');s.w.freightTest.pick(0);s.w.freightTest.pick(1);s.w.document.querySelector('[data-picker-use]').click();
 await s.choose('freight');s.w.freightTest.pick(0);assert.equal(s.w.freightTest.selection().freight,null);s.w.freightTest.pick(2);
 const input=s.w.document.querySelector('[data-freight-share="0"]');input.value='70.000,00';input.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 assert.equal(s.w.document.querySelector('[data-freight-save]').disabled,true);await s.w.freightTest.save();assert.equal(s.writes(),0);
 s.w.document.querySelector('[data-freight-proportional]').click();assert.equal(s.w.document.querySelector('[data-freight-save]').disabled,false);
 }finally{s.close()}});
test('centavos exactos y reintento despues de respuesta perdida no duplican movimiento',async()=>{const s=setup();try{
 const shares=s.w.freightTest.allocate([{id:1,total:1},{id:2,total:1},{id:3,total:1}],0.01);assert.equal(shares.reduce((n,x)=>n+Math.round(x.amount*100),0),1);
 await s.choose('invoice');s.w.freightTest.pick(0);s.w.document.querySelector('[data-picker-use]').click();await s.choose('freight');s.w.freightTest.pick(2);
 const real=s.w.freightTest.save;
 let first=true;s.w.freightTest.setDb({db:{},doc:(_db,...p)=>p.join('/'),serverTimestamp:()=> 'now',runTransaction:async (_db,fn)=>{await fn({get:async ref=>({exists:()=>s.stored.has(ref),data:()=>s.stored.get(ref)}),set:(ref,value)=>s.stored.set(ref,value)});if(first){first=false;throw Error('Respuesta perdida')}}});
 await real();assert.ok(s.w.localStorage.length);await real();assert.equal([...s.stored.values()].filter(x=>x.kind==='movement').length,1);assert.equal(s.w.localStorage.length,0);
 }finally{s.close()}});
test('quita facturas desde reparto y permite aplicar seleccion vacia',async()=>{const s=setup();try{
 await s.choose('invoice');s.w.freightTest.pick(0);s.w.freightTest.pick(1);s.w.document.querySelector('[data-picker-use]').click();
 s.w.document.querySelector('[data-freight-remove="0"]').click();assert.equal(s.w.freightTest.selection().invoices.length,1);assert.equal(s.w.freightTest.selection().invoices[0].id,2);
 await s.choose('invoice');s.w.freightTest.pick(1);const use=s.w.document.querySelector('[data-picker-use]');assert.equal(use.disabled,false);use.click();
 assert.equal(s.w.freightTest.selection().invoices.length,0);assert.equal(s.w.freightTest.selection().invoice,null);assert.equal(s.w.document.querySelector('[data-freight-save]').disabled,true);
 }finally{s.close()}});
test('refresca proveedor y total de una factura ya seleccionada',async()=>{const s=setup();try{
 await s.choose('invoice');s.w.freightTest.pick(0);s.w.document.querySelector('[data-picker-use]').click();
 s.rows[0]={...s.rows[0],proveedor:'CLAW PACK',total:20000.01};await s.choose('invoice');s.w.document.querySelector('[data-picker-use]').click();
 assert.equal(s.w.freightTest.selection().invoices[0].proveedor,'CLAW PACK');assert.equal(s.w.freightTest.selection().invoices[0].total,20000.01);
 }finally{s.close()}});
