const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('gestion.html','utf8');
const tick=()=>new Promise(r=>setTimeout(r,25));
function setup(){
 const dom=new JSDOM(html,{url:'http://localhost/gestion.html#caja/diaria',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()}),w=dom.window,calls=[],timers=[];
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.CSS={escape:v=>v};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.document.fonts={ready:Promise.resolve()};w.CorralonSystem={BRANCHES:[{id:'progreso_ruta',name:'Progreso',nombre:'Progreso',sucursal:1},{id:'calle5_espana',name:'Calle 5',sucursal:2}]};
 w.localStorage.setItem('corralon_menu_active_user_snapshot_v1',JSON.stringify({id:'test',cajaModo:'lector'}));
 w.eval(fs.readFileSync('funciones.js','utf8'));
 w.fetch=async(url,options={})=>{calls.push({url:String(url),options});const action=new URL(url,'http://localhost').searchParams.get('accion');return {ok:true,json:async()=>action==='bootstrap'?{ok:true,token:'test',editar:false,restringido:false,depositos:[],operadores:[],cajasHoy:[],pagos:[],tarjetas:[]}:{ok:true,cabecera:null,detalle:[],efectivo:[],filas:[],articulos:[],valores:[],tarjetas:[],ventas:[],cobros:[],diferencias:[]}};};
 w.setInterval=(callback,delay)=>{timers.push({callback,delay});return timers.length;};
 w.CorralonInvoiceSections={cajaRoute(){},openMenu(){},restoreRoute(){}};
 w.eval(w.document.getElementById('invoice-caja-module').textContent);
 return{dom,w,calls,timers};
}
test('Caja se monta dentro del mismo documento, sin iframe ni descargar caja.html',async()=>{
 const s=setup();try{
 assert.equal(s.calls.length,0);const host=s.w.document.getElementById('systemCajaContent');
 const module=s.w.createIntegratedCaja(host,'diaria');await tick();
 assert.ok(host.shadowRoot.querySelector('#cajaSqlMain'));assert.ok(host.shadowRoot.querySelector('#cajaCobranzas'));
 assert.equal(host.ownerDocument,s.w.document);assert.equal(host.querySelector('iframe'),null);assert.equal(s.w.document.getElementById('systemCajaFrame'),null);
 assert.equal(s.calls.some(call=>call.url.includes('caja.html')),false);assert.equal(s.calls.some(call=>call.options.method==='POST'),false);
 assert.equal(typeof module.navigate,'function');assert.equal(s.w.CajaSQL,undefined);
 await module.navigate('adicionales');await tick();
 assert.equal(host.shadowRoot.querySelector('#cajaAdditionalPopup').classList.contains('open'),true,host.shadowRoot.querySelector('#sqlCajaStatus').textContent);
 await module.navigate('cobranzas');await tick();
 assert.equal(host.shadowRoot.querySelector('#cajaAdditionalPopup').classList.contains('open'),false);
 assert.equal(host.shadowRoot.querySelector('#cajaCobranzas').hidden,false);
 const poll=s.timers.find(timer=>timer.delay===2000);assert.ok(poll);
 module.setActive(false);const pausedCount=s.calls.length;poll.callback();await tick();assert.equal(s.calls.length,pausedCount);
 module.setActive(true);poll.callback();await tick();assert.ok(s.calls.length>pausedCount);
 assert.equal(s.calls.some(call=>call.options.method==='POST'),false);

 await module.navigate('diaria');await tick();assert.equal(host.shadowRoot.querySelector('#cajaSqlMain').hidden,false);assert.equal(host.shadowRoot.querySelector('#cajaCobranzas').hidden,true);

 }finally{s.w.close();}
});


test('Reimprimir abre selector nativo, imprime sólo al confirmar y bloquea duplicados',async()=>{
 const s=setup();try{
 const baseFetch=s.w.fetch,printed=[];let finishPrint;
 s.w.fetch=async(url,options)=>{
  const action=new URL(url,'http://localhost').searchParams.get('accion');
  if(action==='cobranzas')return {ok:true,json:async()=>({ok:true,filas:[{id:42,numero:'0004-42',cliente:'Prueba',total:100}]})};
  if(action==='cobranza-detalle')return {ok:true,json:async()=>({idRecibo:42,version:'v1',articulos:[],valores:[]})};
  return baseFetch(url,options);
 };
 s.w.CorralonInvoiceHistoryActions={cajaPrinters:async()=>({selected:'',printers:[{value:'server:POS80',label:'Servidor · POS80'}]}),printCaja:(...args)=>{printed.push(args);return new Promise(resolve=>finishPrint=resolve);}};
 const host=s.w.document.getElementById('systemCajaContent'),module=s.w.createIntegratedCaja(host,'diaria');await tick();await module.navigate('cobranzas');await tick();
 const root=host.shadowRoot,row=root.querySelector('[data-cc-id="42"]');assert.ok(row);
 row.dispatchEvent(new s.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await tick();root.querySelector('[data-cc-reprint]').click();await tick();
 const dialog=root.querySelector('[data-cc-print-dialog]');assert.equal(dialog.open,true);assert.equal(dialog.querySelector('iframe'),null);assert.equal(dialog.ownerDocument,s.w.document);
 const select=dialog.querySelector('select'),submit=dialog.querySelector('[type="submit"]');assert.equal(submit.disabled,true);assert.equal(printed.length,0);
 select.value='server:POS80';select.dispatchEvent(new s.w.Event('change'));assert.equal(submit.disabled,false);submit.click();submit.click();await tick();assert.deepEqual(printed,[[42,'server:POS80']]);
 assert.equal(dialog.querySelector('[data-cc-print-close]').disabled,true);const cancel=new s.w.Event('cancel',{cancelable:true});assert.equal(dialog.dispatchEvent(cancel),false);
 finishPrint();await tick();assert.equal(dialog.open,false);assert.equal(s.calls.some(call=>call.url.includes('reimprimirCaja')),false);
 }finally{s.w.close();}
});
