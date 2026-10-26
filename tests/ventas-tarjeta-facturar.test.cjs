const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('respaldo/ventas-tarjeta.html','utf8'),script=html.match(/<script id="ventas-tarjeta-facturar">([\s\S]*?)<\/script>/)[1],api=fs.readFileSync('facturacion-copia-api.cs','utf8');
const tick=()=>new Promise(r=>setTimeout(r,15));
async function setup(edit=true,storage={}){
 const dom=new JSDOM(html,{url:'http://localhost:8080/ventas-tarjeta.html',runScripts:'outside-only'}),w=dom.window,calls=[],animations=[],viewed=[];let fail=false,uncertain=false;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;
 w.HTMLElement.prototype.scrollIntoView=function(){};w.eval(html.match(/<script id="funciones">([\s\S]*?)<\/script>/)[1]);w.CorralonFunciones={...w.CorralonFunciones,menuSessionUser:()=>({id:'tester'}),menuUserIsAdministrator:()=>edit,animacionCarga:(...args)=>animations.push(args)};w.CorralonInvoiceHistory={openInvoice:async(...args)=>viewed.push(args)};
 w.document.getElementById('rows').innerHTML='<tr data-receipt="77" data-voucher="13"><td>X</td></tr><tr data-receipt="88" data-voucher="2"><td>B</td></tr>';
 w.fetch=async(url,options={})=>{calls.push({url,options});if(url.includes('/estado-emision'))return{ok:true,json:async()=>({ok:true,estado:uncertain?'incierto':'sinRegistro'})};if(options.body&&fail)throw Error('Conexión interrumpida');return{ok:true,json:async()=>options.body?{ok:true,idRecibo:999,numero:'0009-00000111'}:{ok:true,borradorId:'source-guid',version:'source-version',origen:{numero:'0009-00000999',total:100,puntoVenta:9},facturas:[],puntosVenta:[{id:9,nombre:'Origen',tipo:1},{id:10,nombre:'Otro',tipo:1},{id:10,nombre:'Otro',tipo:2}],clientes:[{id:2,nombre:'Responsable',idTipoIva:1,documento:'20300000001'},{id:3,nombre:'Municipalidad',idTipoIva:4,documento:'30300000001'}]}}};
 for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);w.eval(script);return{dom,w,calls,animations,viewed,q:s=>w.document.querySelector(s),fail:()=>{fail=true},uncertain:()=>{uncertain=true},open:async()=>{w.document.querySelector('#rows td').dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:5,clientY:5}));w.document.getElementById('cardIssueOpen').click();await tick();}};
}
test('clic derecho solo ofrece Facturar para X y editores; cliente se filtra por A/B y fecha queda limitada',async()=>{
 const s=await setup();try{await s.open();assert.equal(s.q('#cardIssueDialog').open,true);s.q('#cardIssueCustomer').value='Respon';s.q('#cardIssueCustomer').dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.match(s.q('#cardIssueCustomer').parentElement.textContent,/Responsable/);assert.doesNotMatch(s.q('#cardIssueCustomer').parentElement.textContent,/Municipalidad/);s.q('#cardIssueType').value='2';s.q('#cardIssueType').dispatchEvent(new s.w.Event('change'));s.q('#cardIssueCustomer').value='Munici';s.q('#cardIssueCustomer').dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.match(s.q('#cardIssueCustomer').parentElement.textContent,/Municipalidad/);assert.doesNotMatch(s.q('#cardIssueCustomer').parentElement.textContent,/Responsable/);assert.ok(s.q('#cardIssueDate').min<s.q('#cardIssueDate').max);assert.equal(s.calls.some(c=>c.options.body),false);}finally{s.dom.window.close()}
 const reader=await setup(false);try{reader.q('#rows td').dispatchEvent(new reader.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));assert.equal(reader.q('#cardIssueContext').hidden,true);}finally{reader.dom.window.close()}
});
test('confirmación conserva operación ante corte; reintento no cambia receptor, fecha, origen ni versión',async()=>{
 const s=await setup();try{await s.open();s.q('#cardIssueCustomer').value='Responsable · 20300000001 · #2';s.w.confirm=()=>false;s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(s.calls.some(c=>c.options.body),false);
 s.w.confirm=()=>true;s.fail();s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(s.q('#cardIssueFields').disabled,true);assert.match(s.q('#cardIssueSubmit').textContent,/reintentar/);const first=JSON.parse(s.calls.find(c=>c.options.body).options.body);assert.equal(first.idRecibo,77);assert.equal(first.cliente,2);assert.equal(first.version,'source-version');assert.equal(first.accion,'facturar');
 s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();const posts=s.calls.filter(c=>c.options.body);assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);assert.ok(s.w.localStorage.getItem('corralon_facturar_x_fecha_v1:tester'));
 }finally{s.dom.window.close()}
});
test('emisión exitosa usa animacion, cierra formulario, avisa a la grilla y no abre la factura',async()=>{
 const s=await setup();try{await s.open();s.q('#cardIssueCustomer').value='Responsable · 20300000001 · #2';s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.match(s.q('#cardIssueStatus').textContent,/confirmada/);assert.equal(s.q('#cardIssueSubmit').disabled,true);assert.equal(s.w.localStorage.getItem('corralon_facturar_x_pendiente_v1:tester'),null);assert.equal(s.q('[data-issued]').dataset.issued,'999');assert.equal(s.viewed.length,0);assert.equal(s.q('#cardIssueDialog').open,false);assert.deepEqual(s.animations.map(a=>a[0]),['syncing','success']);}finally{s.dom.window.close()}
});
test('servidor reutiliza Emit, valida origen/versión y tipo, no descuenta stock ni duplica informe',()=>{
 new vm.Script(script);assert.match(api,/return Emit\(c,invoice,false,false\)/);assert.match(api,/AssertCardFiscalOrigin\(connection,tx,invoice\)/);assert.match(api,/if \(!quotation && !cardConversion\)/);assert.match(api,/ActStock=0,EnInfVtas=0,Pagada=1/);assert.match(api,/facturarOrigenVersion/);assert.match(api,/CardFiscalDraftId\(cardSource\)/);assert.match(api,/La boleta X ya está vinculada/);assert.ok(api.indexOf('El total recalculado no coincide con la boleta X')<api.indexOf('authorization = FiscalAuthorize(afipType'));
});

test('un resultado fiscal incierto consulta ARCA y bloquea otro POST de emision',async()=>{
 const s=await setup();try{await s.open();s.q('#cardIssueCustomer').value='Responsable · 20300000001 · #2';s.fail();s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();s.uncertain();s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(s.calls.filter(c=>c.options.body).length,1);assert.ok(s.calls.some(c=>c.url.includes('/estado-emision')));assert.match(s.q('#cardIssueStatus').textContent,/pendiente/);assert.ok(s.w.localStorage.getItem('corralon_facturar_x_pendiente_v1:tester'));}finally{s.dom.window.close()}
});

test('razon social es un unico campo editable con lista y exige elegir un cliente SQL',async()=>{
 const s=await setup();try{await s.open();assert.equal(s.q('#cardIssueCustomerSearch'),null);assert.equal(s.q('#cardIssueCustomer').tagName,'INPUT');assert.equal(s.q('#cardIssueCustomer').getAttribute('role'),'combobox');s.q('#cardIssueCustomer').value='Respon';s.q('#cardIssueCustomer').dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.match(s.q('#cardIssueCustomer').parentElement.textContent,/Responsable/);s.q('#cardIssueCustomer').value='Respons';s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(s.calls.some(c=>c.options.body),false);assert.match(s.q('#cardIssueCustomer').validationMessage,/lista/);s.q('#cardIssueCustomer').value='Responsable · 20300000001 · #2';s.q('#cardIssueCustomer').dispatchEvent(new s.w.Event('input'));s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(JSON.parse(s.calls.find(c=>c.options.body).options.body).cliente,2);}finally{s.dom.window.close()}
});

test('punto de venta elegible se envia y queda fijado con la operacion pendiente',async()=>{
 const s=await setup();try{await s.open();assert.equal(s.q('#cardIssuePoint').value,'9');s.q('#cardIssuePoint').value='10';s.q('#cardIssueCustomer').value='Responsable · 20300000001 · #2';s.fail();s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();const sent=JSON.parse(s.calls.find(c=>c.options.body).options.body);assert.equal(sent.puntoVenta,10);assert.equal(JSON.parse(s.w.localStorage.getItem('corralon_facturar_x_pendiente_v1:tester')).puntoVenta,10);assert.equal(s.q('#cardIssueFields').disabled,true);}finally{s.dom.window.close()}
 const s2=await setup();try{await s2.open();s2.q('#cardIssueType').value='2';s2.q('#cardIssueType').dispatchEvent(new s2.w.Event('change'));assert.doesNotMatch(s2.q('#cardIssuePoint').innerHTML,/Origen/);assert.match(s2.q('#cardIssuePoint').innerHTML,/Otro/);}finally{s2.dom.window.close()}
});

test('recuerda las cuatro opciones al cerrar, recargar y facturar otra boleta',async()=>{
 const key='corralon_facturar_x_opciones_v1:tester',s=await setup();let storage;
 try{await s.open();s.q('#cardIssueType').value='2';s.q('#cardIssueType').dispatchEvent(new s.w.Event('change'));s.q('#cardIssuePoint').value='10';s.q('#cardIssuePoint').dispatchEvent(new s.w.Event('change'));s.q('#cardIssueCustomer').value='Municipalidad · 30300000001 · #3';s.q('#cardIssueCustomer').dispatchEvent(new s.w.Event('input'));const day=s.q('#cardIssueDate').min;s.q('#cardIssueDate').value=day;s.q('#cardIssueDate').dispatchEvent(new s.w.Event('change'));s.q('#cardIssueCancel').click();storage={[key]:s.w.localStorage.getItem(key)};assert.deepEqual(JSON.parse(storage[key]),{tipo:2,puntoVenta:10,cliente:3,fecha:day});}finally{s.dom.window.close()}
 const next=await setup(true,storage);try{next.q('#rows tr').dataset.receipt='79';await next.open();assert.equal(next.q('#cardIssueType').value,'2');assert.equal(next.q('#cardIssuePoint').value,'10');assert.equal(next.q('#cardIssueCustomer').value,'Municipalidad · 30300000001 · #3');assert.equal(next.q('#cardIssueDate').value,JSON.parse(storage[key]).fecha.split('-').reverse().join('/'));next.q('#cardIssueForm').dispatchEvent(new next.w.Event('submit',{cancelable:true}));await tick();const body=JSON.parse(next.calls.find(c=>c.options.body).options.body);assert.equal(body.idRecibo,79);assert.equal(body.cliente,3);assert.equal(body.tipo,2);assert.equal(body.puntoVenta,10);assert.equal(body.fecha,JSON.parse(storage[key]).fecha);}finally{next.dom.window.close()}
});

test('opciones recordadas respetan fecha y cliente habilitado; pendiente conserva sus propios datos',async()=>{
 const key='corralon_facturar_x_opciones_v1:tester',defaults=JSON.stringify({tipo:2,puntoVenta:999,cliente:2,fecha:'2001-01-01'});
 const s=await setup(true,{[key]:defaults});try{await s.open();assert.equal(s.q('#cardIssueCustomer').value,'');assert.equal(s.q('#cardIssuePoint').value,'');assert.equal(s.q('#cardIssueDate').value,s.q('#cardIssueDate').max.split('-').reverse().join('/'));}finally{s.dom.window.close()}
 const pending={accion:'facturar',idRecibo:77,version:'source-version',tipo:1,puntoVenta:9,cliente:2,fecha:new Date().toLocaleDateString('en-CA')};
 const s2=await setup(true,{[key]:defaults,'corralon_facturar_x_pendiente_v1:tester':JSON.stringify(pending)});try{await s2.open();assert.equal(s2.q('#cardIssueType').value,'1');assert.equal(s2.q('#cardIssuePoint').value,'9');assert.match(s2.q('#cardIssueCustomer').value,/Responsable/);assert.equal(s2.q('#cardIssueFields').disabled,true);}finally{s2.dom.window.close()}
});

test('razon social se elige desde la lista compartida y fecha flexible respeta el limite',async()=>{
 const s=await setup();try{await s.open();s.q('#cardIssueCustomer').value='Respon';s.q('#cardIssueCustomer').dispatchEvent(new s.w.Event('input',{bubbles:true}));const option=s.q('#cardIssueCustomer').parentElement.querySelector('[role="option"]');assert.match(option.textContent,/Responsable/);option.dispatchEvent(new s.w.MouseEvent('mousedown',{bubbles:true}));s.q('#cardIssueDate').value='01/01/2001';s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(s.calls.some(c=>c.options.body),false);assert.match(s.q('#cardIssueDate').validationMessage,/5 días/);const iso=s.q('#cardIssueDate').max;s.q('#cardIssueDate').value=iso.split('-').reverse().join('/');s.q('#cardIssueForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(JSON.parse(s.calls.find(c=>c.options.body).options.body).fecha,iso);}finally{s.dom.window.close()}
});








