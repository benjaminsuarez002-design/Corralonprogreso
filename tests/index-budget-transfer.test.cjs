const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const index=fs.readFileSync('index.html','utf8'),history=fs.readFileSync('historial.html','utf8');
const source=index.slice(index.indexOf('function abrirTransferenciaPresupuestoConfirmado('),index.indexOf("document.getElementById('buyButton').addEventListener"));
test('transferencia del popup solo abre en localhost y reutiliza Historial',()=>{
 for(const host of ['localhost','corralonprogreso.com','192.168.1.10']){
 const dom=new JSDOM('',{url:`http://${host}/index.html`,runScripts:'outside-only'}),w=dom.window;
 try{w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.eval(source);w.abrirTransferenciaPresupuestoConfirmado('0001-00000396');const frame=w.document.querySelector('iframe');if(host==='localhost'){assert.ok(frame);assert.equal(frame.getAttribute('src'),'historial.html?embed=presupuesto-sql');w.abrirTransferenciaPresupuestoConfirmado('otro');assert.equal(w.document.querySelectorAll('iframe').length,1)}else assert.equal(frame,null)}finally{dom.window.close()}
 }
});
test('Historial consulta el presupuesto persistido y abre la transferencia existente sin emitir',async()=>{
 const dom=new JSDOM('<div id="appContent"></div>',{url:'http://localhost/historial.html?embed=presupuesto-sql',runScripts:'outside-only'}),w=dom.window,messages=[],calls=[];
 try{const parent={postMessage:m=>messages.push(m)};Object.defineProperty(w,'parent',{value:parent});w.SUPABASE_URL='http://data';w.PRESUPUESTOS_TABLE='presupuestos_web';w.CorralonSystem={headers:()=>({})};w.cargaSqlDisponible=()=>true;w.fetch=async url=>{calls.push(url);return {ok:true,json:async()=>[{id:123,numero:'0001-00000396',items:[{codigo:'009735',cantidad:2}]}]}};let budget;
 w.abrirTransferenciaPresupuestoSql=async()=>{budget=w._presupuestoDetalleActual;const dialog=w.document.createElement('dialog');dialog.dataset.budgetTransferDialog='';w.document.body.append(dialog)};
 w.eval(history.slice(history.indexOf('function inicializarHistorial()'),history.indexOf('function activarTabHistorial(')));w.inicializarHistorial();assert.equal(messages[0].type,'corralon:presupuesto-sql-ready');
 w.dispatchEvent(new w.MessageEvent('message',{origin:w.location.origin,source:parent,data:{type:'corralon:presupuesto-sql-open',numero:'0001-00000396'}}));await new Promise(r=>setTimeout(r,10));assert.equal(budget.id,123);assert.equal(budget.items[0].cantidad,2);assert.match(calls[0],/presupuestos_web\?numero=eq\.0001-00000396/);assert.equal(calls.length,1);
 }finally{dom.window.close()}
});
