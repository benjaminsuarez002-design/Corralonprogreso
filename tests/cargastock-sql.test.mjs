import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../respaldo/cargastock.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('const STOCK_INGRESO_DRAFT_KEY ='),html.indexOf("document.getElementById('compareStockBtn').addEventListener"));
const fields=new Map();
const field=id=>{if(!fields.has(id))fields.set(id,{id,value:'',checked:true,type:'text',textContent:'',dataset:{},addEventListener(){},selectedOptions:[{textContent:'Ajuste de Stock'}]});return fields.get(id);};
const storage=new Map(),calls=[];let stock=4;
const ctx=vm.createContext({console,URLSearchParams,Uint8Array,crypto:globalThis.crypto,Date,Map,WeakMap,Number,JSON,Math,
 document:{getElementById:field,querySelectorAll:()=>[],activeElement:{blur(){}}},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 window:{confirm:()=>true}, rowsData:[],providers:[],provider:null,providerArticles:[],providerArticlesOrdered:[],providerArticleSearch:new WeakMap(),
 selectedProvider:()=>({id:1}),CorralonSystem:{providerIdentity:{externalId:()=>1},articleOptionPager:{prepare:x=>x}},
 el:{rows:{inert:false},providerInput:{value:'PROVEEDOR'}},escapeHtml:x=>String(x),codeKey:x=>String(x).toUpperCase(),norm:x=>String(x).toUpperCase(),
 rawNumber:x=>String(x),quantityNumber:x=>Number(String(x).replace(',','.')),moneyNumber:x=>Number(String(x).replace(',','.')),money:x=>String(x),
 calcPrecioFinal:r=>Number(r.precio||0),calcPrecioFinalCantidad:r=>Number(r.precio||0)*Number(r.cantidad||0),isBlankStockRow:r=>!r.codigo,
 render(){},saveRows(){},pushUndoSnapshot(){},providerDiscountValue:()=>0,precioUnitarioDesdeFinal:(_,x)=>x,
 fetch:async(url,options)=>{if(options?.method==='POST'){const body=JSON.parse(options.body);calls.push(body);if(body.accion==='confirmar')stock=9;return {ok:true,status:200,json:async()=>({ok:true,idRecibo:99,numeroMovimiento:123,total:500,articulos:[{idart:'000010',cantidad:5,precioUnitario:100,stockDespues:9}]})};}
 const query=new URL(String(url),'http://local').searchParams.get('consulta');
 const data=query==='articulos'?{articulos:[{idart:'000010',codProv:'ABC',proveedor:1,descripcion:'CEMENTO',stock,precioCosto:100}]}:query==='compras'?{compras:[]}:query==='relacionados'?{relacionados:[]}:{sucursales:[{id:1,nombre:'Sucursal'}],puntosVenta:[{id:7,idSucursal:1}],tiposMovimiento:[{id:23,nombre:'Compra'},{id:35,nombre:'Ajuste'}],operador:[{nombre:'Benjamin'}]};
 return {ok:true,json:async()=>({ok:true,...data})};}
});
vm.runInContext(code,ctx);
field('stockIngresoSucursal').value='1';
await vm.runInContext('initStockSql()',ctx);
field('stockIngresoSucursal').value='1';field('stockTipoMovimiento').value='23';
ctx.rowsData=[{codigo:'ABC',descripcion:'CEMENTO',cantidad:'1',precio:100,idart:'000010'}];
vm.runInContext(`stockSetQuantity(rowsData[0],"'9")`,ctx);
assert.equal(ctx.rowsData[0].cantidad,'5');assert.equal(ctx.rowsData[0].conteo,9);assert.equal(field('stockTipoMovimiento').value,'35');
vm.runInContext(`stockSetQuantity(rowsData[0],"'2")`,ctx);
assert.equal(ctx.rowsData[0].cantidad,'-2');assert.equal(ctx.rowsData[0].conteo,2);
assert.throws(()=>vm.runInContext(`stockSetQuantity(rowsData[0],"'abc")`,ctx),/conteo válido/);
vm.runInContext(`stockSetQuantity(rowsData[0],"'9")`,ctx);
const data=vm.runInContext('stockIngresoData()',ctx);
assert.equal(data.articulos[0].conteo,9);assert.equal(data.tipoMovimiento,35);assert.equal(data.puntoVenta,7);
// Simular respuesta perdida: recuperar la misma solicitud, aunque el stock visible haya cambiado.
storage.set('corralon_stock_ingreso_sql_v1',JSON.stringify({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fingerprint:JSON.stringify(data),status:'uncertain'}));
ctx.rowsData[0].cantidad='2';ctx.rowsData[0].stock=7;
await vm.runInContext('confirmStockIngreso()',ctx);
assert.equal(calls.length,2);assert.equal(calls[0].articulos[0].cantidad,5);assert.equal(calls[1].id,calls[0].id);
assert.equal(ctx.rowsData[0].cantidad,'5','el refresco no convierte el ajuste confirmado en cero');
assert.equal(JSON.parse(storage.get('corralon_stock_ingreso_sql_v1')).status,'confirmed');
assert.equal(ctx.el.rows.inert,true);
await vm.runInContext('confirmStockIngreso()',ctx);assert.equal(calls.length,2,'no reemite movimiento confirmado');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'IDs de DOM únicos');
assert.ok(!html.includes('id="stockIngresoBackdrop"'));
// La conexión SQL debe arrancar al abrir, aunque el catálogo siga cargando.
const startupStart=html.lastIndexOf('(async()=>{');
const startup=html.slice(startupStart,html.indexOf('</script>',startupStart));
let sqlStarted=false,repairStarted=false;
const startupContext=vm.createContext({console,Promise,
 loadRows:async()=>{},loadPriceComparisons:async()=>{},render(){},
 initStockSql:async()=>{sqlStarted=true;},
 loadProviders:()=>new Promise(()=>{}),loadIndexCodes:async()=>{},
 stockRebuildArticleOptions(){},stockRefreshRelations:async()=>{},
 repairUnmatchedIndexRows:async()=>{repairStarted=true;}
});
vm.runInContext(startup,startupContext);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(sqlStarted,true,'SQL arranca sin esperar el catálogo');
assert.equal(repairStarted,false);
console.log('PASS inventario, recuperación, bloqueo de duplicados y layout integrado');
