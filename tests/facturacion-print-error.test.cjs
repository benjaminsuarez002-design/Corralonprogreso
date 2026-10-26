const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('gestion.html','utf8');
const code=html.slice(html.indexOf('function handleConfirmedPrintError('),html.indexOf('function closeDraftModal('));
test('aviso ofrece otra impresora y reinicio sólo en localhost después de confirmar',async()=>{
 const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');const dom=new JSDOM('<body><button id="chooseTicketPrinter"></button></body>',{url:'http://localhost:8080/gestion.html',runScripts:'outside-only'}),w=dom.window;
 try{
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};let accepted=false,calls=[];w.confirm=()=>accepted;w.alert=()=>{};w.AbortSignal=AbortSignal;w.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({ok:true,mensaje:'Reiniciada'})}};w.LOCAL_PRINTER_API='http://127.0.0.1:8082';w.$=selector=>w.document.querySelector(selector);
 w.eval(html.slice(html.indexOf('async function restartLocalPrintQueue('),html.indexOf('function handleConfirmedPrintError(')));
 w.CorralonPrinterHelp.show(new Error('Sin conexión'),{number:'0005-00007813',confirmed:true});const dialog=w.document.querySelector('dialog'),buttons=[...dialog.querySelectorAll('button')];assert.match(dialog.textContent,/confirmado/);assert.match(dialog.textContent,/otra impresora/);const restart=buttons.find(b=>b.textContent.includes('Reiniciar'));restart.click();await new Promise(r=>setTimeout(r,10));assert.equal(calls.length,0);
 accepted=true;restart.click();await new Promise(r=>setTimeout(r,10));assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:8082/reiniciar-cola');assert.equal(calls[0].options.method,'POST');assert.equal(JSON.parse(calls[0].options.body).confirmar,true);
 let chosen=0;w.document.getElementById('chooseTicketPrinter').onclick=()=>chosen++;buttons.find(b=>b.textContent==='Elegir otra impresora').click();assert.equal(chosen,1);assert.equal(w.document.querySelector('dialog'),null);
 }finally{w.close()}
});
function setup(issuedReceipt){
 const nodes=new Map();const $=key=>{if(!nodes.has(key))nodes.set(key,{value:key,classList:{remove(){}},focus(){}});return nodes.get(key)};
 const s={issuedReceipt,previewDraft:{},printerSelectionPending:true,browserPrintPending:true,REPRINT_CAJA_ID:0,$,messages:[],alerts:[],saved:0,applyData(value){assert.equal(value,null);s.issuedReceipt=null;s.cleared=true},renderVoucherTypes(){},saveDraft:async()=>{s.saved++},setMsg:value=>s.messages.push(value),alert:value=>s.alerts.push(value),console};
 s.showPrinterFailure=(error,{number})=>s.alerts.push('Error de impresión '+number+' Reimprimir últ. fact.');vm.createContext(s);vm.runInContext(code,s);return s;
}
test('error después de confirmar limpia la venta, cierra la vista previa y muestra aviso con número',()=>{
 const s=setup({idRecibo:42,numero:'0004-00000042'});s.handleConfirmedPrintError(new Error('Sin conexión'));
 assert.equal(s.issuedReceipt,null);assert.equal(s.previewDraft,null);assert.equal(s.printerSelectionPending,false);assert.equal(s.browserPrintPending,false);assert.equal(s.saved,1);
 assert.match(s.alerts[0],/Error de impresión/);assert.match(s.alerts[0],/0004-00000042/);assert.match(s.alerts[0],/Reimprimir últ/);
});
test('fallo reimprimiendo un comprobante anterior conserva la venta actual sin confirmar',()=>{
 const s=setup(null);s.handleConfirmedPrintError(new Error('Papel agotado'),{idRecibo:41,numero:'ANTERIOR'});
 assert.equal(s.cleared,undefined);assert.equal(s.saved,0);assert.match(s.alerts[0],/ANTERIOR/);
});
