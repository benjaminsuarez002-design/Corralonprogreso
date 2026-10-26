const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('historial.html','utf8');
const helper=html.slice(html.indexOf('async function comprobarCargaOrigenSql('),html.indexOf('function transferenciaPresupuestoKey('));
const open=html.slice(html.indexOf('async function abrirCargaRemitoSql('),html.indexOf('async function copiarNumeroBoleta('));
const tick=()=>new Promise(r=>setTimeout(r,15));
function setup(state,pending){
 const dom=new JSDOM('',{url:'http://localhost:8080/historial.html',runScripts:'outside-only'}),w=dom.window,calls=[],messages=[],animations=[],resolved=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new w.Event('close'))};
 w.cargaSqlDisponible=()=>true;w._detalleTipoActual='remito';w._remitoDetalleActual={id:17,nro:17,sucursal:'Progreso',total:100,sql_resultado:{compraId:10,stockId:20}};w._remitosCache=[w._remitoDetalleActual];
 w.CorralonFunciones={animacionCarga:(...args)=>animations.push(args),menuSessionUser:()=>({id:'Ana'})};w.CorralonSystem={headers:()=>({})};w.SUPABASE_URL='http://example.test';w.esc=String;w.fmt=String;w.remitoFull=String;w.toast=m=>messages.push(m);w.resolverRemitoCargadoSql=async r=>resolved.push(r.id);w.setAccionesDetalleModo=()=>{};
 w.remitoSqlPendingKey=id=>'remito:'+id;w.recuperarProveedorRemitoSql=async()=>{};w.redondearRenglonesRemitoSql=p=>p;w.remitoSqlPayload=()=>({remitoId:17,sucursal:1,proveedor:5,pago:3,articulos:[{idart:'000010',cantidad:1,precio:100}]});
 if(pending)w.localStorage.setItem('remito:17',JSON.stringify(pending));
 w.fetch=async(url,options)=>{
  calls.push({url,body:options?.body&&JSON.parse(options.body)});
  const data=String(url).includes('estado-origen')?{ok:true,...state}:String(url).includes('consulta=opciones')?{ok:true,puntosVenta:[{sucursal:1,empresa:1}],proveedores:[{id:5,cuenta:'A',tipoBien:1}],cuentas:[{id:'A',nombre:'Ferreteria-Construccion',empresa:1}],bienes:[{id:1,nombre:'Mercaderia'}],pagos:[{id:3,nombre:'Cta Cte'}]}:options?.method==='PATCH'?[{id:17}]:{ok:true,factura:[{IDRecibo:30,stockId:40,NroFactura:'NEW',stockNumero:50}]};
  return{ok:true,json:async()=>data};
 };
 w.eval(helper+open);return{dom,w,calls,messages,animations,resolved};
}
test('remito anulado y compra eliminada rehabilita la carga y descarta resultado antiguo',async()=>{
 const s=setup({vigente:false,puedeRecargar:true,hayAnterior:true},{payload:{sucursal:1,proveedor:5,pago:3},result:{compraId:10,stockId:20}});try{
  await s.w.abrirCargaRemitoSql();const d=s.w.document;assert.ok(d.querySelector('dialog'));assert.equal(s.w._remitoDetalleActual.sql_resultado,null);assert.equal(s.w.localStorage.getItem('remito:17'),null);
  d.querySelector('[data-sql-save]').click();await tick();const post=s.calls.find(c=>c.body?.remitoId===17);assert.ok(post);assert.equal(s.w._remitoDetalleActual.sql_resultado.compraId,30);assert.equal(s.w.document.querySelector('dialog'),null);assert.deepEqual(s.animations.map(a=>a[0]),['syncing','success']);assert.deepEqual(s.resolved,[17]);
 }finally{s.dom.window.close()}
});
test('carga vigente sin sincronización web pendiente y anulación parcial no se duplican',async()=>{
 for(const complete of [true,false]){const s=setup({vigente:true,cargado:complete,mensaje:'Carga vigente'});try{await s.w.abrirCargaRemitoSql();assert.equal(s.w.document.querySelector('dialog'),null);assert.equal(s.calls.filter(c=>c.body).length,0);assert.match(s.messages.at(-1),/vigente/)}finally{s.dom.window.close()}}
});
test('si SQL ya se guardó y faltaba vincular la web recupera el resultado y no reenvía la compra',async()=>{
 const s=setup({vigente:true,cargado:true,resultado:{compraId:30,numero:'NEW',stockId:40,stockNumero:50}},{payload:{sucursal:1,proveedor:5,pago:3},result:{compraId:10}});try{
  await s.w.abrirCargaRemitoSql();s.w.document.querySelector('[data-sql-save]').click();await tick();assert.equal(s.calls.filter(c=>c.body?.remitoId).length,0);assert.equal(s.calls.filter(c=>String(c.url).startsWith('http://example.test')).length,1);assert.equal(s.w._remitoDetalleActual.sql_resultado.compraId,30);assert.equal(s.w.document.querySelector('dialog'),null);assert.deepEqual(s.animations.map(a=>a[0]),['syncing','success']);assert.deepEqual(s.resolved,[17]);
 }finally{s.dom.window.close()}
});

