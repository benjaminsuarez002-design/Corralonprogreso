const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {JSDOM}=createRequire(path.join(__dirname,'../.codex-staging/importer-dom-test/package.json'))('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../respaldo/cargar-facturas.html'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(api){
 const popup=html.match(/<dialog id="stockPicker"[\s\S]*?<\/dialog>/)[0];
 const dom=new JSDOM('<input id="movement" value="anterior"><input id="inStock" type="checkbox" checked><input id="point" value="2">'+popup);
 const $=id=>dom.window.document.getElementById(id),comboLists=new Map();let saves=0;
 $('stockPicker').showModal=function(){this.open=true;};
 $('stockPicker').close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const context={console,Event:dom.window.Event,$,comboLists,api,selectedProvider:()=>({id:5505,nombre:'COLON'}),hidePurchaseCombo(){},
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),money:value=>'$ '+value,
  fillCombo:(id,items)=>comboLists.set(id,items),setComboValue:(id,value)=>$(id).value=String(value),saveDraft(){saves++;}};
 vm.createContext(context);
 const start=html.indexOf('  let stockPickerSelection = null'),end=html.indexOf('  async function refreshStock()',start);
 vm.runInContext(html.slice(start,end)+'\nglobalThis.openPicker=openStockPicker;globalThis.preview=previewStockMovement;',context);
 return {dom,$,context,saves:()=>saves};
}
const movement={id:123,numero:45,fecha:'08/10/2026',sucursal:1,sucursalNombre:'CORRALON PROGRESO',tipo:'Compras de Mercadería',total:120};
test('ver una carga no la vincula: conserva el campo hasta confirmar la selección',async()=>{
 const calls=[];const f=fixture(async params=>{calls.push(params);return params.consulta==='movimientos'?{movimientos:[movement]}:{articulos:[{idart:'009693',codigo:'14233',descripcion:'IMPERMEABILIZANTE',cantidad:3,precioUnitario:40,importe:120}]};});
 await f.context.openPicker();
 assert.match(f.$('stockPickerRows').textContent,/CORRALON PROGRESO/);assert.match(f.$('stockPickerRows').textContent,/Compras de Mercadería/);
 f.$('stockPickerRows').querySelector('td').click();await flush();
 assert.match(f.$('stockPickerArticles').textContent,/009693/);assert.equal(f.$('movement').value,'anterior');assert.equal(f.$('stockPickerUse').disabled,false);
 f.$('stockPickerUse').click();assert.equal(f.$('movement').value,'123');assert.equal(f.saves(),1);assert.equal(f.$('stockPicker').open,false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{consulta:'movimientos',proveedor:5505,puntoVenta:'2'},{consulta:'detalle-stock',id:123,proveedor:5505,puntoVenta:'2'}]);f.dom.window.close();
});
test('una carga que deja de estar disponible no puede seleccionarse',async()=>{
 const f=fixture(async params=>{if(params.consulta==='movimientos')return {movimientos:[movement]};throw Error('Otra PC vinculó la carga');});
 await f.context.openPicker();await f.context.preview(123);
 assert.equal(f.$('stockPickerUse').disabled,true);assert.match(f.$('stockPickerStatus').textContent,/Otra PC/);assert.equal(f.$('movement').value,'anterior');f.dom.window.close();
});
test('una respuesta tardía no rellena un popup que ya se cerró',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=f.context.openPicker();f.$('stockPicker').close();finish({movimientos:[movement]});await pending;
 assert.equal(f.$('stockPickerRows').textContent,'');assert.equal(f.$('movement').value,'anterior');f.dom.window.close();
});
