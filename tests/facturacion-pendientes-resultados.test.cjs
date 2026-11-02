const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const h=fs.readFileSync('gestion.html','utf8');
test('rechazo explicito ofrece X conservando la venta y no emite automaticamente',async()=>{
 const dom=new JSDOM('<input id="docNumber">',{runScripts:'outside-only'}),w=dom.window;try{
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 const context={document:w.document,$:s=>w.document.querySelector(s),sqlConfig:{comprobantes:[{id:13,idPuntoVenta:4}]},draftId:'draft',issuedReceipt:null,recoveryPending:false,selected:0,saves:0,renderVoucherTypes(id){context.selected=id},async saveDraft(){context.saves++},setMsg(){}};vm.createContext(context);
 const a=h.indexOf('async function showRejectedInvoiceOptions('),b=h.indexOf('async function issue(){',a);vm.runInContext(h.slice(a,b),context);
 await context.showRejectedInvoiceOptions({id:'draft',idPuntoVenta:4},new Error('Documento invalido'));
 const button=[...w.document.querySelectorAll('button')].find(x=>x.textContent==='Continuar como X-venta');assert.ok(button);await button.onclick();assert.equal(context.selected,13);assert.equal(context.saves,1);assert.equal(w.document.querySelector('dialog'),null);
 }finally{w.close()}
});
test('SQL confirmado con contenido distinto no vuelve a enviar revision',async()=>{
 const calls=[],nodes=new Map();const $=s=>{if(!nodes.has(s))nodes.set(s,{value:s==='#voucherType'?'13':'',classList:{remove(){}}});return nodes.get(s)};
 const context={recoveryPending:true,draftId:'draft',recoveryCanRetry:false,$,SQL_PREPARACION:'/api',fetch:async url=>({ok:true,json:async()=>url.includes('estado-emision')?{ok:true,estado:'emitido',idRecibo:1,numero:'0004-00000001'}:{ok:true}}),formData:()=>({}),assertReceiptMatches(){const e=new Error('Distinto');e.saleReview=true;throw e},setRecoveryAlert:m=>calls.push(m),renderRecoveryResult:s=>calls.push(s),lockIssued(){},window:{CorralonSaleReviews:{async handle(){throw Error('No debe crear revision')}}}};vm.createContext(context);
 const a=h.indexOf('async function verifyRecovery('),b=h.indexOf('async function reconcileBackgroundPending(',a);vm.runInContext(h.slice(a,b),context);await context.verifyRecovery();assert.equal(calls.find(x=>x&&typeof x==='object').estado,'emitido');assert.ok(calls.some(x=>typeof x==='string'&&/ya est.*confirmada/.test(x)));assert.equal(context.recoveryPending,true);
});
