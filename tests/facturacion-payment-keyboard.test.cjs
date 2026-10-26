const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const source=fs.readFileSync('gestion.html','utf8'),functions=fs.readFileSync('funciones.js','utf8');
const focus=functions.slice(functions.indexOf('  function focusField('),functions.indexOf('  function bindLinearNavigation('));
function setup(){
 const dom=new JSDOM('<table id="paymentTable"><tbody id="paymentBody"></tbody></table><span id="paymentRecordCount"></span><div id="paymentOptions"></div>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.structuredClone=structuredClone;
 w.eval(focus+';window.CorralonFunciones={focusField};');
 w.eval(fs.readFileSync('facturacion-medios-pago.js','utf8'));
 w.eval(`const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],n=v=>Number(v)||0,norm=v=>String(v||'').toLowerCase(),esc=v=>String(v??''),num=v=>String(v),money=v=>String(v||0),roundMoney=v=>Math.round(v*100)/100;
 let issuedReceipt=null,paymentReconcileTimer=0,payments=[{tipo:'Efectivo',idTipoPago:1,importe:100,idTarjeta:0,tarjeta:'Ninguna',cuotas:0,coef:0,impRec:0,descripcion:''}];
 const sqlConfig={tiposPago:[{id:1,nombre:'Efectivo',clase:1},{id:6,nombre:'Transf Bria.',clase:3},{id:7,nombre:'Tarjeta',clase:5}],tarjetas:[{id:10,nombre:'Banco'},{id:11,nombre:'MP Transferencia'}],tarjetasCuotas:[{idTarjeta:10,cuotas:3,coeficiente:0}]};
 function allowedPaymentTypes(){return sqlConfig.tiposPago;}function allowedCardsFor(){return sqlConfig.tarjetas;}function paymentType(row){return sqlConfig.tiposPago.find(p=>p.id===Number(row.idTipoPago)||p.nombre===row.tipo);}function ensureBlanks(){}function appendFillerRows(){}function renderTotals(){}function markPaymentRuleProblems(){}function scheduleDraft(){}function showDeletedRowToast(){}function blankPayment(){return {tipo:'Efectivo',importe:0};}function totals(){return {base:100,difference:0};}function paymentStarted(){return true;}const invoiceDocumentEvent=(...args)=>document.addEventListener(...args);`+
 source.slice(source.indexOf('function cardPlans('),source.indexOf('function renderTotals(){'))+
 source.slice(source.indexOf('function bindPaymentGridNavigation(){'),source.indexOf('function bindFunctions(){'))+
 `;renderPayments();bindPaymentGridNavigation();window.payTest={rows:()=>payments};`);
 const key=(field,value)=>field.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
 const pick=label=>{const input=w.document.querySelector('[data-p="tipo"]');input.focus();input.value=label;input.dispatchEvent(new w.Event('input',{bubbles:true}));key(input,'Enter');};
 return {w,dom,key,pick};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
test('Enter en transferencia abre cuentas; flechas y Enter eligen y avanzan a descripción',async()=>{
 const s=setup();try{s.pick('Transf');await tick();const account=s.w.document.querySelector('[data-p="tarjeta"]');assert.equal(s.w.document.activeElement,account);assert.equal(s.w.document.querySelector('#paymentOptions').classList.contains('open'),true);assert.equal(account.selectionEnd,account.value.length);
 s.key(account,'ArrowDown');s.key(account,'ArrowDown');s.key(account,'Enter');await tick();assert.equal(s.w.payTest.rows()[0].idTarjeta,11);assert.equal(s.w.document.activeElement.dataset.p,'descripcion');assert.equal(s.w.document.querySelector('#paymentOptions').classList.contains('open'),false);
 }finally{s.w.close();}
});
test('Tarjeta abre cuentas y Enter avanza a cuotas habilitadas',async()=>{
 const s=setup();try{s.pick('Tarjeta');await tick();const account=s.w.document.querySelector('[data-p="tarjeta"]');assert.equal(s.w.document.activeElement,account);s.key(account,'ArrowDown');s.key(account,'Enter');await tick();assert.equal(s.w.payTest.rows()[0].idTarjeta,10);assert.equal(s.w.document.activeElement.dataset.p,'cuotas');assert.equal(s.w.document.activeElement.disabled,false);}finally{s.w.close();}
});
test('Efectivo conserva el paso al importe y no abre una lista de cuentas',async()=>{
 const s=setup();try{s.pick('Efectivo');await tick();assert.equal(s.w.document.activeElement.dataset.p,'importe');assert.equal(s.w.document.querySelector('[data-p="tarjeta"]').disabled,true);assert.equal(s.w.document.querySelector('#paymentOptions').classList.contains('open'),false);}finally{s.w.close();}
});
test('clic en la opción Transferencia también enfoca y despliega la cuenta',async()=>{
 const s=setup();try{const input=s.w.document.querySelector('[data-p="tipo"]');input.focus();input.value='Transf';input.dispatchEvent(new s.w.Event('input',{bubbles:true}));[...s.w.document.querySelectorAll('[data-payment-index]')].find(el=>el.textContent==='Transf Bria.').click();await tick();assert.equal(s.w.document.activeElement.dataset.p,'tarjeta');assert.equal(s.w.document.querySelector('#paymentOptions').classList.contains('open'),true);}finally{s.w.close();}
});
test('Enter con transferencia ya elegida vuelve a desplegar las cuentas sin borrar la selección',async()=>{
 const s=setup();try{s.pick('Transf');await tick();let field=s.w.document.querySelector('[data-p="tarjeta"]');s.key(field,'ArrowDown');s.key(field,'Enter');await tick();const id=s.w.payTest.rows()[0].idTarjeta;field=s.w.document.querySelector('[data-p="tipo"]');field.focus();s.key(field,'Enter');assert.equal(s.w.document.activeElement.dataset.p,'tarjeta');assert.equal(s.w.document.querySelector('#paymentOptions').classList.contains('open'),true);assert.equal(s.w.payTest.rows()[0].idTarjeta,id);}finally{s.w.close();}
});
