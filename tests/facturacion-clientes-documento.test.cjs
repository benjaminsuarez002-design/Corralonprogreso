const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('gestion.html','utf8');
const helpers=html.slice(html.indexOf('function registeredCustomerDocumentError('),html.indexOf('let missingSellerDialog='));
function setup({id=10,document='1231231',stored='1231231',duplicates=[],fail=false,conflict=false}={}){
 const dom=new JSDOM('<body><input id="customerName" value="CLIENTE" data-id-cliente="'+id+'"><select id="docType"><option>DNI</option><option>CUIT</option></select><input id="docNumber"><input id="customerTax"><input id="customerAddress"><input id="customerPhone"><input id="customerEmail"></body>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,calls=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(`const $=s=>document.querySelector(s),SQL_PREPARACION='/api',esc=v=>String(v??''),norm=v=>String(v||'').toLowerCase(),customerUpper=v=>String(v||'').toUpperCase(),n=v=>Number(v)||0,money=v=>'$ '+v,formatCuit=v=>String(v).replace(/\\D/g,''),uid=()=>({id:'seller'});let draftId='sale',recoveryPending=false,issuedReceipt=null,issueInProgress=false,saleSwitchBusy=false,creditCheckInProgress=false,customerBalanceState=null,customerCatalog=[];function renderCustomerBalance(){}function scheduleDraft(){}function setMsg(){}function syncCustomerTaxShort(){}function customerAllowedForVoucher(){return true;}alert=()=>{};`+helpers+`;window.helpers={require:requireRegisteredCustomerDocument,error:registeredCustomerDocumentError,switch:()=>draftId='other'};`);
 w.document.querySelector('#docNumber').value=document;
 w.fetch=async(url,options={})=>{
  calls.push({url,options});if(fail)throw new Error('SQL no disponible');
  if(options.method==='POST'){
   if(conflict)return {ok:false,json:async()=>({ok:false,error:'Otro puesto modificó el documento.'})};
   const data=JSON.parse(options.body);stored=data.documento;return {ok:true,json:async()=>({ok:true,cliente:{id:10,nombre:'CLIENTE',documento:stored,idTipoDoc:50}})};
  }
  const q=new URL(url,'http://localhost').searchParams;
  if(q.has('validarDocumento')){const value=q.get('documento'),error=w.helpers.error(q.get('tipoDocumento'),value);return {ok:true,json:async()=>({ok:true,valido:!error&&!duplicates.length,error:error||(duplicates.length?'Esta cuenta ya existe.':''),requiereGuardar:stored!==value,cliente:{id:10,documento:stored,idTipoDoc:50},coincidencias:!error?duplicates:[]})};}
  return {ok:true,json:async()=>({ok:true,cliente:{id:20,nombre:'CUENTA EXISTENTE',documento:'20369324587',idTipoDoc:67,idTipoIva:1,saldoSql:500,suspendido:false}})};
 };
 return {w,calls,close:()=>w.close()};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('rechaza números cortos, letras, relleno periódico y CUIT con verificador incorrecto',()=>{
 const s=setup();try{for(const value of ['','123','123123','1231231','12312312','11111111','12345678','00000001','123123123','f4287197'])assert.match(s.w.helpers.error('DNI',value),/no es válido/);
 for(const value of ['36932458','4287197','04.287.197'])assert.equal(s.w.helpers.error('DNI',value),'');
 assert.equal(s.w.helpers.error('CUIT','20-36932458-7'),'');for(const value of ['20369324585','00000000000','123'])assert.match(s.w.helpers.error('CUIT',value),/no es válido/);
 }finally{s.close();}
});
test('consumidor final y cliente temporal no realizan el control de cuenta registrada',async()=>{
 const s=setup({id:1});try{assert.equal(await s.w.helpers.require(),true);assert.equal(s.calls.length,0);}finally{s.close();}
});
test('cliente con documento válido sin cambios continúa sin popup ni escritura',async()=>{
 const s=setup({document:'36932458',stored:'36932458'});try{assert.equal(await s.w.helpers.require(),true);assert.equal(s.calls.length,1);assert.equal(s.w.document.querySelector('dialog'),null);}finally{s.close();}
});
test('corrección de documento se guarda en ficha antes de permitir continuar',async()=>{
 const s=setup();try{const result=s.w.helpers.require();await tick();const dialog=s.w.document.querySelector('dialog');assert.match(dialog.textContent,/no es válido/);dialog.querySelector('input').value='36932458';dialog.querySelector('form').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(await result,true);const post=s.calls.find(c=>c.options.method==='POST');assert.equal(JSON.parse(post.options.body).documentoAnterior,'1231231');assert.equal(JSON.parse(post.options.body).soloDocumento,true);assert.equal(s.w.document.querySelector('#docNumber').value,'36932458');assert.ok(s.calls.every(c=>!c.url.includes('/emitir')));}finally{s.close();}
});
test('coincidencia con otra cuenta muestra saldo y exige selección explícita, sin emitir',async()=>{
 const s=setup({document:'36932458',stored:'36932458',duplicates:[{id:20,nombre:'CUENTA EXISTENTE',documento:'20369324587',saldoSql:500,suspendido:0}]});try{const result=s.w.helpers.require();await tick();const dialog=s.w.document.querySelector('dialog');assert.match(dialog.textContent,/CUIT\/CUIL: 20369324587/);assert.match(dialog.textContent,/Saldo: \$ 500/);assert.equal(s.w.document.querySelector('#customerName').dataset.idCliente,'10');[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Usar esta cuenta').click();await tick();assert.equal(await result,false);assert.equal(s.w.document.querySelector('#customerName').dataset.idCliente,'20');assert.equal(s.calls.filter(c=>c.options.method==='POST').length,0);}finally{s.close();}
});
test('un conflicto al guardar conserva el aviso y bloquea la continuación',async()=>{
 const s=setup({conflict:true});try{const result=s.w.helpers.require();await tick();let dialog=s.w.document.querySelector('dialog');dialog.querySelector('input').value='36932458';dialog.querySelector('form').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.match(dialog.textContent,/Otro puesto/);assert.equal(s.w.document.querySelector('#docNumber').value,'1231231');dialog.querySelector('[data-document-cancel]').click();assert.equal(await result,false);}finally{s.close();}
});
test('fallo de SQL bloquea confirmación y no convierte un documento en validado',async()=>{
 const s=setup({fail:true});try{assert.equal(await s.w.helpers.require(),false);assert.equal(s.calls.length,1);}finally{s.close();}
});
