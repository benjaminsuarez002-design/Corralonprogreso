const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('respaldo/caja.html','utf8');

test('desde Adicionales abre Cobranzas y retira la capa que la tapaba; permite regresar',async()=>{
 const dom=new JSDOM('<main></main><div id="popup" class="open"><section></section></div>'),w=dom.window;
 const popup=w.document.getElementById('popup'),main=w.document.querySelector('main');let route='adicionales',collectionsHidden=true;
 const context={window:w,main,popup,current:null,boot:{sucursal:1},run:async task=>task(),saveDetail:async()=>{},
  CajaSQL:{flush:async()=>{},load:async()=>{}},recordCajaSection:view=>route=view,cajaSectionRoute:()=>route,
  synchronizeDate(){},selectCajaBranch(){},CAJA_BRANCH_KEY:'branch',toolsReady:Promise.resolve(),cajaBranches:[],loadedSupabaseCajaCacheDate:'hoy',selectedDateKey:'hoy',
  localStorage:{getItem:()=>null},fitAdditionalTools(){},$:()=>({focus(){}})};
 w.cajaSystemInactive=true;w.cajaSqlDollarStarted=true;
 w.CajaCobranzas={async open(){collectionsHidden=false;main.hidden=true;},close(){collectionsHidden=true;main.hidden=false;}};
 vm.createContext(context);
 for(const [startMarker,endMarker]of [['  async function openAdditional(',"  $('sqlCajaAdditional').onclick"],['  async function openCollections(',"  $('sqlCajaCollections').onclick"]]){
  const start=html.indexOf(startMarker);vm.runInContext(html.slice(start,html.indexOf(endMarker,start)),context);
 }
 try{
  await context.openCollections();assert.equal(route,'cobranzas');assert.equal(collectionsHidden,false);assert.equal(main.hidden,true);assert.equal(popup.classList.contains('open'),false);
  await context.openAdditional();assert.equal(route,'adicionales');assert.equal(collectionsHidden,true);assert.equal(main.hidden,false);assert.equal(popup.classList.contains('open'),true);
  await context.openCollections();assert.equal(collectionsHidden,false);assert.equal(popup.classList.contains('open'),false);
 }finally{w.close();}
});

test('navegación integrada espera la carga y respeta pausa y operaciones en curso',async()=>{
 const dom=new JSDOM('<div id="popup"><section></section></div>',{url:'http://localhost/caja.html?sistema=1'}),w=dom.window,calls=[];
 let route='diaria';w.cajaInSystem=true;w.CajaCobranzas={canLeave:()=>true};w.CorralonInvoiceSections={cajaRoute:view=>calls.push(['route',view])};
 const context={window:w,document:w.document,popup:w.document.getElementById('popup'),busy:false,
  cajaSectionRoute:()=>route,openAdditional:async()=>{route='adicionales';w.document.getElementById('popup').classList.add('open');calls.push(['additional']);},openCollections:async()=>{route='cobranzas';calls.push(['collections']);},
  run:async task=>task(),saveDetail:async()=>calls.push(['save']),CajaSQL:{flush:async()=>calls.push(['flush'])},recordCajaSection:view=>route=view,restoreCajaSection:async()=>{w.document.getElementById('popup').classList.remove('open');calls.push(['restore']);}};
 vm.createContext(context);const start=html.indexOf('  let systemReady=false,systemPendingView=null;');
 vm.runInContext(html.slice(start,html.indexOf("  $('sqlCajaDate').value = TODAY_DATE_KEY;",start)),context);
 try{
 const module=w.CorralonCajaSection;
 await module.navigate('adicionales');assert.equal(calls.length,0);
 vm.runInContext('systemReady=true',context);module.setActive(false);await module.navigate('adicionales');assert.equal(calls.length,0);
 module.setActive(true);context.busy=true;await module.navigate('adicionales');assert.equal(calls.length,0);
 context.busy=false;await module.navigate('adicionales');assert.equal(route,'adicionales');const before=calls.length;
 await module.navigate('adicionales');assert.equal(calls.length,before);
 await module.navigate('diaria');assert.equal(route,'diaria');assert.deepEqual(calls.slice(-4),[['save'],['flush'],['restore'],['route','diaria']]);
 // Back/forward may restore the iframe URL before the visible section changes.
 for(const previous of ['adicionales','cobranzas']){
  const popup=w.document.getElementById('popup');let collections=w.document.getElementById('cajaCobranzas');
  if(!collections){collections=w.document.createElement('section');collections.id='cajaCobranzas';w.document.body.append(collections);}
  popup.classList.toggle('open',previous==='adicionales');collections.hidden=previous!=='cobranzas';route='diaria';
  const count=calls.filter(call=>call[0]==='restore').length;
  await module.navigate('diaria');assert.equal(calls.filter(call=>call[0]==='restore').length,count+1);assert.equal(popup.classList.contains('open'),false);collections.hidden=true;
 }

 }finally{w.close();}
});

test('todos los scripts de Caja mantienen sintaxis válida',()=>{
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/src=|application\/json/.test(match[1]))continue;
  new vm.Script(match[2]);
 }
});
