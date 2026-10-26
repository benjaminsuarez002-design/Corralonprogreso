const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('respaldo/ventas-tarjeta.html','utf8'),script=html.match(/<script id="ventas-tarjeta">([\s\S]*?)<\/script>/)[1];
const tick=()=>new Promise(r=>setTimeout(r,10));
async function setup(edit=true){
 const dom=new JSDOM(html,{url:'http://localhost:8080/ventas-tarjeta.html',runScripts:'outside-only'}),w=dom.window,calls=[];let fail=false,invoice;
 const rows=[{idRecibo:1,orden:11,fecha:'2026-10-19',tipo:'BFACT',numero:'0009-00000958',cuotas:1,cliente:'Cliente <SQL>',numeroTarjeta:'ref',total:100,cobrada:true,tipoPago:'Tarjeta',tarjeta:'Visa',puntoVenta:'Ruta',version:'v1'},{idRecibo:1,orden:12,fecha:'2026-10-19',tipo:'BFACT',numero:'0009-00000958',cuotas:2,cliente:'Cliente <SQL>',total:50,cobrada:true,version:'v1'},{idRecibo:2,orden:13,fecha:'2026-10-19',tipo:'NCREB',numero:'0009-00000001',cuotas:0,cliente:'Otro',total:-20,cobrada:false,version:'v2'}];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;
 w.HTMLElement.prototype.scrollIntoView=function(){};w.eval(html.match(/<script id="funciones">([\s\S]*?)<\/script>/)[1]);w.CorralonFunciones={...w.CorralonFunciones,menuUserIsAdministrator:()=>edit,menuUserHasAccess:()=>true,menuSessionUser:()=>({id:'usuario'})};
 w.CorralonInvoiceHistory={openInvoice:async(...args)=>{invoice=args}};
 w.fetch=async(url,options={})=>{calls.push({url,options});if(fail)throw Error('SQL sin conexión');const body=options.body&&JSON.parse(options.body);return{ok:true,json:async()=>url.includes('consulta=opciones')?{ok:true,tarjetas:[{id:4,nombre:'Visa'}]}:body?{ok:true,idRecibo:1,version:'v3',cobrada:false}:url.includes('consulta=informe')?{ok:true,filas:[{deposito:'Ruta',tarjeta:'Visa',total:123}]}:{ok:true,filas:structuredClone(rows)}}};
 w.eval(script);await tick();return {dom,w,calls,q:s=>w.document.querySelector(s),fail:()=>{fail=true},get invoice(){return invoice}};
}
test('consulta conserva renglones y totales firmados; filtra y ve factura en lectura',async()=>{const s=await setup();try{
 assert.equal(s.q('#rows').rows.length,3);assert.match(s.q('#paid').value,/150,00/);assert.match(s.q('#pending').value,/-.*20,00/);assert.match(s.q('#total').value,/130,00/);assert.match(s.q('#rows').textContent,/Cliente <SQL>/);assert.equal(s.q('#rows script'),null);
 s.q('#invoice').click();await tick();assert.equal(s.invoice[0],1);assert.equal(s.invoice[2].readOnly,true);
 s.q('#state').value='pending';s.q('#state').dispatchEvent(new s.w.Event('change'));assert.equal(s.q('#rows').rows.length,1);assert.match(s.q('#total').value,/-.*20,00/);
 }finally{s.dom.window.close()}});

test('clic derecho cambia la seleccion a la fila apuntada y Ver factura usa esa boleta',async()=>{const s=await setup();try{
 assert.equal(s.q('#rows .selected').dataset.key,'1:11');s.q('#rows tr[data-key="2:13"] td').dispatchEvent(new s.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));assert.equal(s.w.document.querySelectorAll('#rows .selected').length,1);assert.equal(s.q('#rows .selected').dataset.key,'2:13');assert.match(s.q('#count').textContent,/Registro: 3 de 3/);s.q('#invoice').click();await tick();assert.equal(s.invoice[0],2);
 }finally{s.dom.window.close()}});
test('lector no desmarca; desmarcar requiere confirmación y actualiza todos los valores de la boleta',async()=>{
 const reader=await setup(false);try{assert.equal(reader.q('[data-uncheck]').disabled,true);assert.equal(reader.calls.some(c=>c.options.method==='POST'),false)}finally{reader.dom.window.close()}
 const s=await setup();try{
 s.w.confirm=()=>false;s.q('[data-uncheck]').click();await tick();assert.equal(s.calls.some(c=>c.options.method==='POST'),false);
 s.w.confirm=()=>true;s.q('[data-uncheck]').click();await tick();const body=JSON.parse(s.calls.find(c=>c.options.method==='POST').options.body);assert.equal(body.accion,'desmarcar');assert.equal(body.idRecibo,1);assert.equal(body.version,'v1');assert.equal(body.usuarioId,'usuario');assert.equal(s.q('#rows').textContent.includes('0009-00000958'),true);assert.equal(s.q('#rows input:checked'),null);assert.match(s.q('#pending').value,/130,00/);assert.equal(s.q('[data-uncheck]').disabled,true);
 }finally{s.dom.window.close()}
});
test('fallo de guardado restaura tilde y no cambia importes; error de lectura conserva última consulta',async()=>{const s=await setup();try{
 s.fail();s.q('[data-uncheck]').click();await tick();assert.equal(s.q('[data-uncheck]').checked,true);assert.match(s.q('#total').value,/130,00/);assert.match(s.q('#status').textContent,/SQL sin conexión/);
 s.q('#filters').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(s.q('#rows').rows.length,3);
 }finally{s.dom.window.close()}});
test('informe tiene fechas independientes y formato de resumen por sucursal y tarjeta',async()=>{const s=await setup();try{
 s.q('#report').click();await tick();assert.equal(s.q('#reportDialog').open,true);assert.match(s.q('#reportFrame').srcdoc,/123,00/);assert.match(s.q('#reportFrame').srcdoc,/Importe − ImpRec/);assert.ok(s.calls.some(c=>c.url.includes('consulta=informe')));
 }finally{s.dom.window.close()}});

test('filtros usan desplegable de funciones y fechas flexibles conservando ISO para SQL',async()=>{const s=await setup();try{
 assert.equal(s.q('#card').getAttribute('role'),'combobox');s.q('#card').value='Vi';s.q('#card').dispatchEvent(new s.w.Event('input',{bubbles:true}));const option=s.q('#card').parentElement.querySelector('[role="option"]');assert.equal(option.textContent,'Visa');option.dispatchEvent(new s.w.MouseEvent('mousedown',{bubbles:true}));await tick();s.q('#from').value='1/10/26';s.q('#to').value='19/10/2026';s.q('#filters').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.ok(s.calls.some(c=>c.url.includes('desde=2026-10-01')&&c.url.includes('hasta=2026-10-19')&&c.url.includes('tarjeta=4')));
 }finally{s.dom.window.close()}});
test('integración menú, permisos SQL, tema, sintaxis y única escritura permitida',()=>{
 for(const file of ['ventas-tarjeta.html','menu.html','usuarios.html','menu-auth-guard.js','facturacion-consulta.js']){const text=fs.readFileSync(file,'utf8');if(file.endsWith('.html')){for(const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(!/type="module"/.test(m[1]))new vm.Script(m[2])}}else new vm.Script(text);}
 assert.match(html,/<style id="card-sales-theme">/);assert.doesNotMatch(html,/<script[^>]+src=/);assert.doesNotMatch(html,/<link[^>]+rel="stylesheet"/);assert.match(html,/data-menu-guard="ventas_tarjeta"/);assert.match(fs.readFileSync('menu.html','utf8'),/data-menu-id="ventas_tarjeta"/);assert.match(fs.readFileSync('usuarios.html','utf8'),/id: 'ventas_tarjeta', label:/);
 const api=fs.readFileSync('facturacion-copia-api.cs','utf8'),cancel=api.slice(api.indexOf('private static object CardSalesUncheck('),api.indexOf('private static object CollectionReceiptCancel('));assert.match(cancel,/SET Pagada=0/);assert.doesNotMatch(cancel,/SET Pagada=1|DELETE|INSERT/);assert.match(cancel,/CardSalesVersion/);
});
test('filtros por columna combinables recalculan totales y se borran individualmente o juntos',async()=>{const s=await setup();try{
 function apply(field,op,value){s.q(`[data-filter="${field}"]`).click();s.q('#columnOperator').value=op;s.q('#columnValue').value=value;s.q('#columnForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));}
 apply('cliente','contains','SQL');assert.equal(s.q('#rows').rows.length,2);assert.match(s.q('#total').value,/150,00/);
 apply('cuotas','ge','2');assert.equal(s.q('#rows').rows.length,1);assert.match(s.q('#total').value,/50,00/);assert.equal(s.q('[data-filter="cliente"]').classList.contains('filtered'),true);
 s.q('[data-filter="cuotas"]').click();s.q('#columnRemove').click();assert.equal(s.q('#rows').rows.length,2);
 s.q('#clear').click();assert.equal(s.q('#rows').rows.length,3);assert.equal(s.q('#columnFilterSummary').textContent,'');assert.equal(s.calls.some(c=>c.options.method==='POST'),false);
 }finally{s.dom.window.close()}});
test('menú de texto ofrece las ocho operaciones de Access, vacíos, fecha, cobrada y orden explícito',async()=>{const s=await setup();try{
 const expected={eq:2,ne:1,starts:2,notStarts:1,contains:2,notContains:1,ends:2,notEnds:1};
 for(const [op,count] of Object.entries(expected)){s.q('#clear').click();s.q('[data-filter="cliente"]').click();s.q('#columnOperator').value=op;s.q('#columnValue').value=op.includes('tarts')||op==='starts'?'cli':op.toLowerCase().includes('ends')?'SQL>':op==='eq'||op==='ne'?'Cliente <SQL>':'sql';s.q('#columnForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));assert.equal(s.q('#rows').rows.length,count,op);}
 s.q('#clear').click();s.q('[data-filter="numeroTarjeta"]').click();s.q('#columnOperator').value='empty';s.q('#columnForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));assert.equal(s.q('#rows').rows.length,2);
 s.q('#clear').click();s.q('[data-filter="cobrada"]').click();s.q('#columnValue').value='false';s.q('#columnForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));assert.equal(s.q('#rows').rows.length,1);
 s.q('#clear').click();s.q('[data-filter="fecha"]').click();s.q('#columnValue').value='2026-10-19';s.q('#columnForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));assert.equal(s.q('#rows').rows.length,3);
 s.q('[data-filter="total"]').click();s.q('#columnDesc').click();assert.match(s.q('#rows').rows[0].textContent,/100,00/);
 }finally{s.dom.window.close()}});



