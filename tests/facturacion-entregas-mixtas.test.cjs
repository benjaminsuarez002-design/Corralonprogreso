const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('gestion.html','utf8');
const source=html.slice(html.indexOf('async function performAridosDeliverySync('),html.indexOf('const aridosRetryButton='));
function setup(){
 const headers=[],items=[],snapshots=[],notifications=[],ctx={n:Number,roundMoney:v=>Math.round(v*100)/100,draftId:'draft',aridosEntrega:null,saleNeedsAridosDelivery:()=>true,refreshPendingButton:async()=>{},saveAridosDeliveryState:async d=>snapshots.push(structuredClone(d.aridosEntrega)),ensureFaltantesFirebase:async()=>{},failBricks:false};
 const collection=()=>({doc:id=>({get:async()=>({exists:notifications.includes(id)}),set:async()=>notifications.push(id)})});
 ctx.firebase={apps:[{}],firestore:()=>({collection})};ctx.firebase.firestore.FieldValue={serverTimestamp:()=>0};
 ctx.CorralonSystem={SUPABASE_URL:'https://test.invalid',BRANCHES:[{id:1,label:'Progreso'}],headers:x=>x};
 ctx.fetch=async(url,options)=>{const parsed=new URL(url),body=options.body&&JSON.parse(options.body);let result;
  if(options.method==='POST'&&parsed.pathname.endsWith('/remitos')){if(ctx.failBricks&&body.sql_resultado.venta_entrega_tipo==='ladrillones')throw Error('Corte simulado');result=[{...body,id:headers.length+1}];headers.push(result[0]);}
  else if(options.method==='POST'){items.push(...body);result=body;}
  else if(parsed.pathname.endsWith('/items_remito'))result=items.filter(i=>String(i.remito_id)===parsed.searchParams.get('remito_id').slice(3));
  else if(parsed.searchParams.has('sql_resultado->>venta_aridos_id'))result=headers.filter(h=>h.sql_resultado.venta_aridos_id===parsed.searchParams.get('sql_resultado->>venta_aridos_id').slice(3)&&(!parsed.searchParams.has('sql_resultado->>venta_entrega_tipo')||h.sql_resultado.venta_entrega_tipo===parsed.searchParams.get('sql_resultado->>venta_entrega_tipo').slice(3)));
  else result=headers.length?[headers.at(-1)]:[];
  return {ok:true,json:async()=>result};
 };
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const group=(tipo,id)=>({tipo,provider:{id_proveedor:tipo,sqlId:id,nombre:tipo},items:[{idart:tipo,cant:2,precio:100,desc:tipo}],complete:false});
 const data={id:'draft',idComprobante:13,fecha:'2026-10-20',sucursal:1,usuarioId:'test',usuario:'test',emision:{idRecibo:100,numero:'0007-12345678'},aridosEntrega:{groups:[group('arido',1),group('ladrillones',2)],complete:false}};
 return {ctx,headers,items,snapshots,notifications,data};
}
test('genera un remito por grupo con sus propios articulos y permite reintento sin duplicar',async()=>{
 const s=setup();await s.ctx.performAridosDeliverySync(s.data);assert.equal(s.headers.length,2);assert.equal(s.items.length,2);assert.equal(s.headers[0].proveedor_sql_id,1);assert.equal(s.headers[1].proveedor_sql_id,2);assert.equal(s.items[0].remito_id,1);assert.equal(s.items[0].idart,'arido');assert.equal(s.items[1].remito_id,2);assert.equal(s.items[1].idart,'ladrillones');assert.equal(s.data.aridosEntrega.complete,true);assert.ok(s.snapshots.every(d=>d.groups.length===2));assert.equal(s.notifications.length,2);await s.ctx.performAridosDeliverySync(s.data);assert.equal(s.headers.length,2);
});
test('si falla el segundo grupo conserva el primero completo y reintenta solo el faltante',async()=>{
 const s=setup();s.ctx.failBricks=true;await assert.rejects(s.ctx.performAridosDeliverySync(s.data),/Corte simulado/);assert.equal(s.headers.length,1);assert.equal(s.data.aridosEntrega.groups[0].complete,true);assert.equal(s.data.aridosEntrega.complete,false);s.ctx.failBricks=false;await s.ctx.performAridosDeliverySync(s.data);assert.equal(s.headers.length,2);assert.equal(s.items.length,2);assert.equal(s.data.aridosEntrega.complete,true);
});
