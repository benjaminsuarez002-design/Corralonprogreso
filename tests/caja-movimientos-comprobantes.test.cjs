const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const{JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('respaldo/caja.html','utf8');
test('fila de movimientos abre menu y consulta por fecha, sucursal y tipo sin caja abierta',async()=>{
 const dom=new JSDOM('<table><tbody id="movementRows"><tr data-movement-row-key="transf"><td></td><td>Transf Bria.</td></tr></tbody></table><div id="menu"><button>Ver comprobantes</button></div><dialog id="dialog"></dialog><p id="sqlCajaValueTitle"></p><p id="sqlCajaValueInfo"></p>'),w=dom.window,calls=[],$=id=>w.document.getElementById(id);
 const ctx=vm.createContext({document:w.document,$,valueMenu:$('menu'),valueDialog:$('dialog'),valueDay:null,valueOrigin:null,valueFocus:null,valueRequest:0,valueInvoices:[],valueSortKey:'',valueSortDirection:1,current:null,busy:false,selectedDateKey:'2026-10-19',selectedCajaBranchId:()=> 'calle5_espana',normalizarTexto:v=>v.toLowerCase(),innerWidth:1000,innerHeight:700,money:String,status:()=>{},closeValueMenu(){},renderValueInvoices(){},CajaSQL:{bootstrap:async()=>({pagos:[{id:6,nombre:'Transf Bria.'}]}),request:async(...args)=>{calls.push(args);return{filas:[{idRecibo:9,total:100}]}}}});
 ctx.valueDialog.showModal=function(){this.open=true};try{
 vm.runInContext(html.slice(html.indexOf("  $('movementRows').addEventListener('contextmenu',async event=>{"),html.indexOf("  document.addEventListener('pointerdown',event=>{if(!valueMenu",html.indexOf("  $('movementRows').addEventListener('contextmenu',async event=>{"))),ctx);
 const start=html.indexOf("  valueMenu.querySelector('button').onclick=async()=>{");vm.runInContext(html.slice(start,html.indexOf("  const differenceMenu=",start)),ctx);
 $('movementRows').querySelector('td').dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:10,clientY:10}));await new Promise(r=>setImmediate(r));assert.equal(ctx.valueMenu.hidden,false);assert.equal(ctx.valueOrigin.dataset.movementRowKey,'transf');await ctx.valueMenu.querySelector('button').onclick();assert.equal(ctx.valueDialog.open,true);assert.equal(calls[0][0],'comprobantes-dia');assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{fecha:'2026-10-19',sucursal:2,tipoValor:6});assert.match($('sqlCajaValueInfo').textContent,/1 registros/);
 }finally{dom.window.close()}
});

test('Ver recibos y recibo desde Caja reutilizan la consulta conservando caja o filtros del día',()=>{
 const target={href:''};const ctx=vm.createContext({URLSearchParams,Number,window:{location:target},valueDay:null,current:{cabecera:{IDRecibo:88}},selectedDateKey:'2026-10-20'});
 const start=html.indexOf('  function openCajaReceiptConsult(');vm.runInContext(html.slice(start,html.indexOf("  valueMenu.querySelector('button').onclick=",start)),ctx);
 ctx.openCajaReceiptConsult();let url=new URL(target.href,'http://localhost:8080');assert.equal(url.pathname,'/recibos-cobro.html');assert.equal(url.searchParams.get('origen'),'caja');assert.equal(url.searchParams.get('caja'),'88');assert.equal(url.hash,'#consultar');
 ctx.valueDay={fecha:'2026-10-19',sucursal:2,tipoValor:6};ctx.openCajaReceiptConsult(120);url=new URL(target.href,'http://localhost:8080');assert.equal(url.searchParams.get('fecha'),'2026-10-19');assert.equal(url.searchParams.get('sucursal'),'2');assert.equal(url.searchParams.get('tipoValor'),'6');assert.equal(url.searchParams.has('caja'),false);assert.equal(url.hash,'#recibo=120');
 assert.doesNotMatch(html,/const collectionDialog=/);
});
