const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const tick=()=>new Promise(r=>setTimeout(r,20));
async function setup(nivel='administrador',failure=false,discounted=false,customResult=null){
 const dom=new JSDOM('<button id="consultInvoices">Consultar</button>',{url:'http://localhost:8080/gestion.html',runScripts:'outside-only'}),w=dom.window,calls=[];
 const config={sucursales:[],tiposPago:[{id:1,nombre:'Efectivo',clase:1},{id:3,nombre:'Cta. Cte.',clase:6},{id:5,nombre:'Transferencia',clase:3},{id:6,nombre:'Tarjeta',clase:5}],tarjetas:[{id:10,nombre:'Banco'},{id:11,nombre:'Visa'}],tarjetasCuotas:[{idTarjeta:11,cuotas:3}]};
 const result={ok:true,versionValores:'version-original',comprobante:{idRecibo:42,numero:'0007-00034062',idCliente:10883,idComprobante:13,confirmado:-1,anulada:0,total:100,efectivo:100,tarjeta:0,cuentaCorriente:0,cheque:0},articulos:[],valores:[{orden:8,idTipoPago:1,tipo:'Efectivo',clase:1,importe:100,impRec:0,total:100,idTarjeta:0,cuotas:0}]};
 if(discounted){result.comprobante.total=5700;result.comprobante.efectivo=5700;Object.assign(result.valores[0],{importe:5730.8,impRec:-30.8,total:5700,coef:-30.8/5730.8});config.tiposPago.find(p=>p.id===5).recargoInicial=.1;config.tarjetasCuotas[0].coeficiente=.25;}
 if(customResult)Object.assign(result,structuredClone(customResult));
 w.CorralonFunciones={menuSessionUser:()=>({id:'admin-test',nivel}),menuUserIsAdministrator:(_page,user)=>user.nivel==='administrador'};
 const shared=fs.readFileSync(path.join(__dirname,'../funciones.js'),'utf8');w.eval(shared.slice(shared.indexOf('  function focusField('),shared.indexOf('  function bindLinearNavigation('))+';window.CorralonFunciones.focusField=focusField;');
 w.fetch=async(url,options={})=>{calls.push({url,options});let data;
 if(url.endsWith('bootstrap'))data={ok:true,...config};
 else if(options.method==='POST'){const edit=JSON.parse(options.body).valores[0];Object.assign(result.valores[0],edit);if(!failure){result.comprobante.efectivo=0;result.comprobante.cuentaCorriente=100;}data=failure?{ok:false,error:'La boleta cambió en otro equipo.'}:{ok:true};}
 else data=structuredClone(result);
 return{ok:data.ok,json:async()=>data};};
 w.eval(fs.readFileSync(path.join(__dirname,'../facturacion-medios-pago.js'),'utf8'));
 w.eval(fs.readFileSync(path.join(__dirname,'../facturacion-consulta.js'),'utf8'));
 await w.CorralonInvoiceHistory.openInvoice(42);return{dom,w,calls};
}
function change(s,key,value){const input=s.w.document.querySelector(`[data-value-key="${key}"]`);assert.ok(input);input.value=String(value);input.dispatchEvent(new s.w.Event('change',{bubbles:true}));}
function amount(s,label){return [...s.w.document.querySelectorAll('.receipt-field')].find(e=>e.firstChild.textContent===label)?.querySelector('span')?.textContent;}
function enterAmount(s,key,value,index=0){const input=s.w.document.querySelector(`[data-value-index="${index}"][data-value-key="${key}"]`);input.focus();input.value=String(value);input.dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(s.w.document.activeElement,s.w.document.querySelector(`[data-value-index="${index}"][data-value-key="${key}"]`));}

test('elegir transferencia en consulta abre Cuenta/Tarjeta y seleccionar cuenta avanza',async()=>{
 const s=await setup(),opened=[];try{s.w.HTMLSelectElement.prototype.showPicker=function(){opened.push(this.dataset.valueKey);};change(s,'idTipoPago',5);assert.equal(s.w.document.activeElement.dataset.valueKey,'idTarjeta');assert.deepEqual(opened,['idTarjeta']);change(s,'idTarjeta',10);assert.equal(s.w.document.activeElement.dataset.valueKey,'descripcion');}finally{s.dom.window.close();}
});
test('dividir un pago entre efectivo y transferencia conserva el total emitido',async()=>{const s=await setup();try{
 enterAmount(s,'importe','50');assert.match(s.w.document.querySelector('[data-values-difference]').textContent,/0,00/);
 assert.match(s.w.document.querySelector('[data-value-index="1"][data-value-key="importe"]').value,/50,00/);
 const select=s.w.document.querySelector('[data-value-index="1"][data-value-key="idTipoPago"]');select.value='5';select.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 const account=s.w.document.querySelector('[data-value-index="1"][data-value-key="idTarjeta"]');account.value='10';account.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 assert.match(amount(s,'Efectivo:'),/50,00/);assert.match(amount(s,'Cheque:'),/50,00/);assert.match(s.w.document.querySelector('[data-values-difference]').textContent,/0,00/);
 s.w.document.querySelector('[data-save-values]').click();await tick();const posted=JSON.parse(s.calls.find(c=>c.options.method==='POST').options.body);assert.equal(posted.valores.length,2);assert.equal(posted.valores[0].importe,50);assert.equal(posted.valores[1].importe,50);assert.equal(posted.valores[1].orden,null);assert.equal(posted.valores[1].idTarjeta,10);
}finally{s.dom.window.close();}});
test('editar un valor no permite inventar un descuento global en una boleta confirmada',async()=>{const s=await setup();try{
 enterAmount(s,'coef','-10');assert.match(s.w.document.querySelector('[data-value-key="impRec"]').value,/-.*10,00/);assert.match(s.w.document.querySelector('[data-value-key="total"]').value,/90,00/);
 assert.equal(s.w.document.querySelector('[data-value-index="1"]'),null);assert.match(s.w.document.querySelector('[data-values-difference]').textContent,/-.*10,00/);
 s.w.document.querySelector('[data-save-values]').click();await tick();assert.equal(s.calls.filter(c=>c.options.method==='POST').length,0);assert.match(s.w.document.querySelector('[data-action-status]').textContent,/diferencia debe ser cero/);
 enterAmount(s,'impRec','-5');assert.match(s.w.document.querySelector('[data-value-key="coef"]').value,/-5/);enterAmount(s,'impRec','0');assert.equal(Number(s.w.document.querySelector('[data-value-key="impRec"]').value),0);
 s.w.document.querySelector('[data-add-value]').click();assert.equal(s.w.document.querySelectorAll('[data-value-row]').length,2);s.w.document.querySelector('[data-remove-value="1"]').click();assert.equal(s.w.document.querySelectorAll('[data-value-row]').length,1);
}finally{s.dom.window.close();}});

function missingDiscountFixture(){return {
 comprobante:{idRecibo:42,numero:'0004-00039040',idCliente:1,idComprobante:13,confirmado:-1,anulada:0,total:75000,totalArticulos:75127.98,ajusteEmitido:-127.98,efectivo:60000,tarjeta:0,cuentaCorriente:0,cheque:15000},
 articulos:[{idart:'010322',descripcion:'Artículo',cantidad:1,precio:75127.98,importe:75127.98,iva:21}],
 valores:[{orden:8,idTipoPago:1,tipo:'Efectivo',clase:1,importe:60000,impRec:0,total:60000,coef:0,idTarjeta:0,cuotas:0},{orden:9,idTipoPago:5,tipo:'Transferencia',clase:3,importe:15000,impRec:0,total:15000,coef:0,idTarjeta:10,tarjeta:'Banco',cuotas:0}]
};}
test('detecta el descuento perdido aunque total de pagos y total de cabecera sean iguales',async()=>{
 const s=await setup('administrador',false,false,missingDiscountFixture());try{
 assert.match(s.w.document.querySelector('[data-values-difference]').textContent,/127,98/);
 assert.match(s.w.document.querySelector('[data-values-adjustment-info]').textContent,/emitido:.*127,98.*En valores:.*0,00/);
 assert.equal(s.w.document.querySelector('[data-restore-issued-adjustment]').hidden,false);
 s.w.document.querySelector('[data-save-values]').click();await tick();assert.equal(s.calls.filter(c=>c.options.method==='POST').length,0);assert.match(s.w.document.querySelector('[data-action-status]').textContent,/no conservan la base/);
 }finally{s.dom.window.close();}
});
test('reasignar el descuento original conserva efectivo y transferencia y exige guardar explícitamente',async()=>{
 const s=await setup('administrador',false,false,missingDiscountFixture());try{
 s.w.document.querySelector('[data-restore-issued-adjustment]').click();assert.equal(s.calls.filter(c=>c.options.method==='POST').length,0);
 assert.match(s.w.document.querySelector('[data-values-difference]').textContent,/0,00/);
 assert.match(s.w.document.querySelector('[data-value-index="0"][data-value-key="total"]').value,/60.000,00/);assert.match(s.w.document.querySelector('[data-value-index="1"][data-value-key="total"]').value,/15.000,00/);
 s.w.document.querySelector('[data-save-values]').click();await tick();const saved=JSON.parse(s.calls.find(c=>c.options.method==='POST').options.body).valores;
 assert.equal(Math.round(saved.reduce((sum,v)=>sum+v.importe,0)*100),7512798);assert.equal(Math.round(saved.reduce((sum,v)=>sum+v.impRec,0)*100),-12798);
 assert.equal(Math.round((saved[0].importe+saved[0].impRec)*100),6000000);assert.equal(Math.round((saved[1].importe+saved[1].impRec)*100),1500000);
 assert.equal(saved[0].idTipoPago,1);assert.equal(saved[1].idTarjeta,10);
 }finally{s.dom.window.close();}
});
test('la diferencia automática conserva el ajuste emitido al dividir el pago',async()=>{
 const fixture=missingDiscountFixture();fixture.comprobante.efectivo=75000;fixture.comprobante.cheque=0;fixture.valores=[{orden:8,idTipoPago:1,tipo:'Efectivo',clase:1,importe:75127.98,impRec:-127.98,total:75000,coef:-127.98/75127.98,idTarjeta:0,cuotas:0}];
 const s=await setup('administrador',false,false,fixture);try{
 enterAmount(s,'total','60000');assert.match(s.w.document.querySelector('[data-values-difference]').textContent,/0,00/);
 assert.match(s.w.document.querySelector('[data-value-index="1"][data-value-key="total"]').value,/15.000,00/);
 s.w.document.querySelector('[data-save-values]').click();await tick();const saved=JSON.parse(s.calls.find(c=>c.options.method==='POST').options.body).valores;
 assert.equal(Math.round(saved.reduce((sum,v)=>sum+v.importe,0)*100),7512798);assert.equal(Math.round(saved.reduce((sum,v)=>sum+v.impRec,0)*100),-12798);
 }finally{s.dom.window.close();}
});
test('eliminar valores repone la diferencia y nunca deja vacía una boleta con saldo',async()=>{const s=await setup();try{
 enterAmount(s,'importe','40');
 s.w.document.querySelector('[data-remove-value="1"]').click();
 assert.equal(s.w.document.querySelectorAll('[data-value-row]').length,2);
 assert.match(s.w.document.querySelector('[data-value-index="1"][data-value-key="importe"]').value,/60,00/);
 s.w.document.querySelector('[data-remove-value="0"]').click();
 assert.equal(s.w.document.querySelectorAll('[data-value-row]').length,1);
 assert.match(s.w.document.querySelector('[data-value-key="importe"]').value,/100,00/);
 s.w.document.querySelector('[data-remove-value="0"]').click();
 assert.equal(s.w.document.querySelectorAll('[data-value-row]').length,1);
 assert.match(s.w.document.querySelector('[data-value-key="importe"]').value,/100,00/);
 assert.match(s.w.document.querySelector('[data-values-difference]').textContent,/0,00/);
}finally{s.dom.window.close();}});
test('vendedor consulta valores sin controles para cambiarlos',async()=>{const s=await setup('vendedor');try{assert.equal(s.w.document.querySelector('[data-value-key]'),null);assert.equal(s.w.document.querySelector('[data-save-values]'),null);}finally{s.dom.window.close();}});
test('administrador mueve efectivo a cuenta corriente y guarda solo la clasificación',async()=>{const s=await setup();try{
 change(s,'idTipoPago',3);assert.match(amount(s,'Efectivo:'),/0,00/);assert.match(amount(s,'Cta. Cte.:'),/100,00/);
 s.w.document.querySelector('[data-save-values]').click();await tick();
 const posted=JSON.parse(s.calls.find(c=>c.options.method==='POST').options.body);assert.equal(posted.usuarioId,'admin-test');assert.equal(posted.idRecibo,42);assert.equal(posted.version,'version-original');assert.deepEqual(posted.valores,[{orden:8,idTipoPago:3,idTarjeta:0,cuotas:0,importe:100,impRec:0,coef:0,descripcion:''}]);
 assert.match(s.w.document.querySelector('[data-action-status]').textContent,/actualizados/);assert.equal(s.w.document.querySelector('[data-detail-close]').disabled,false);
}finally{s.dom.window.close();}});
test('transferencia se suma a cheque y tarjeta a tarjeta, con el plan seleccionado',async()=>{const s=await setup();try{
 change(s,'idTipoPago',5);change(s,'idTarjeta',10);assert.match(amount(s,'Cheque:'),/100,00/);assert.match(amount(s,'Tarjeta:'),/0,00/);
 change(s,'idTipoPago',6);change(s,'idTarjeta',11);assert.match(amount(s,'Tarjeta:'),/100,00/);assert.match(amount(s,'Cheque:'),/0,00/);assert.equal(s.w.document.querySelector('[data-value-key="cuotas"]').value,'3');
}finally{s.dom.window.close();}});

test('cambiar medio, cuenta o cuotas conserva porcentaje, descuento y total de la boleta',async()=>{const s=await setup('administrador',false,true);try{
 const snapshot=()=>['coef','impRec','total'].map(key=>s.w.document.querySelector(`[data-value-index="0"][data-value-key="${key}"]`).value),before=snapshot();
 change(s,'idTipoPago',5);assert.deepEqual(snapshot(),before);change(s,'idTarjeta',10);assert.deepEqual(snapshot(),before);change(s,'idTipoPago',6);change(s,'idTarjeta',11);change(s,'cuotas',3);assert.deepEqual(snapshot(),before);change(s,'idTipoPago',3);assert.deepEqual(snapshot(),before);
 s.w.document.querySelector('[data-save-values]').click();await tick();const body=JSON.parse(s.calls.find(c=>c.options.method==='POST').options.body);assert.equal(body.valores[0].importe,5730.8);assert.equal(body.valores[0].impRec,-30.8);assert.equal(body.valores[0].coef,-30.8/5730.8);assert.equal(body.valores.length,1);
}finally{s.dom.window.close();}});
test('conflicto al guardar mantiene los cambios y permite reintentar',async()=>{const s=await setup('administrador',true);try{change(s,'idTipoPago',3);s.w.document.querySelector('[data-save-values]').click();await tick();assert.match(s.w.document.querySelector('[data-action-status]').textContent,/otro equipo/);assert.equal(s.w.document.querySelector('[data-save-values]').disabled,false);assert.equal(s.w.document.querySelector('[data-value-key="idTipoPago"]').value,'3');}finally{s.dom.window.close();}});

test('usuario de Caja corrige valores con su transporte sin ampliar permisos de Facturacion',async()=>{const s=await setup('vendedor'),saved=[];try{assert.equal(s.w.document.querySelector('[data-save-values]'),null);await s.w.CorralonInvoiceHistory.openInvoice(42,[],{allowEditValues:true,saveValues:async payload=>saved.push(payload)});change(s,'idTipoPago',3);s.w.document.querySelector('[data-save-values]').click();await tick();assert.equal(saved.length,1);assert.equal(saved[0].valores[0].idTipoPago,3);assert.equal(s.calls.filter(c=>c.options.method==='POST').length,0);s.w.CorralonInvoiceHistory.close();await s.w.CorralonInvoiceHistory.openInvoice(42);assert.equal(s.w.document.querySelector('[data-save-values]'),null);}finally{s.dom.window.close();}});



test('administrador de Caja anula con su transporte y conserva el bloqueo fiscal',async()=>{
 const s=await setup('vendedor');try{
 const fetch=s.w.fetch;s.w.fetch=async(...args)=>{const response=await fetch(...args),data=await response.json();if(data.comprobante){data.versionAnulacion='cancel-v1';data.bloqueoAnulacionFiscal=false;}return {...response,json:async()=>data}};
 let cancelled,reprinted;s.w.confirm=()=>true;
 const options={allowAnnul:true,cancelInvoice:async payload=>{cancelled=payload},actions:{reprint:async id=>{reprinted=id;return {preview:false}}}};
 await s.w.CorralonInvoiceHistory.openInvoice(42,[],options);
 const buttons=()=>[...s.w.document.querySelectorAll('button')];
 const annul=buttons().find(b=>b.textContent==='Anular boleta');assert.equal(annul.hidden,false);assert.equal(annul.disabled,false);
 s.w.document.querySelector('[data-reprint]').click();await tick();assert.equal(reprinted,42);
 annul.click();await tick();assert.equal(cancelled.idRecibo,42);assert.equal(cancelled.version,'cancel-v1');assert.equal(s.calls.some(c=>String(c.url||c).includes('comprobante-anular')),false);
 s.w.fetch=async(...args)=>{const response=await fetch(...args),data=await response.json();if(data.comprobante){data.versionAnulacion='cancel-v1';data.bloqueoAnulacionFiscal=true;}return {...response,json:async()=>data}};
 await s.w.CorralonInvoiceHistory.openInvoice(42,[],options);assert.equal(annul.disabled,true);assert.match(annul.title,/nota de crédito/);
 }finally{s.dom.window.close()}
});
