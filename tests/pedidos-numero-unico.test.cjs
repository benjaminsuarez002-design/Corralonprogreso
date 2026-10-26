const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('pedidos.html','utf8');
const fn=source.slice(source.indexOf('async function setOrderWithMonthlyTotal('),source.indexOf('async function tombstoneOrder('));
function harness(initial={}){
 const docs=new Map(Object.entries(initial)),pending=[];
 const ref=(collection,id)=>({key:`${collection}/${id}`,async get(){return{exists:docs.has(this.key),data:()=>docs.get(this.key),ref:this}}});
 const versions=new Map();
 const firestore={collection:name=>({doc:id=>ref(name,id)}),async runTransaction(cb){
  for(let attempt=0;attempt<20;attempt++){
   const writes=[],reads=new Map();
   await cb({get:async r=>{
    assert.equal(writes.length,0,'Firebase exige leer antes de escribir');
    const data=docs.get(r.key);reads.set(r.key,versions.get(r.key)||0);
    return {exists:docs.has(r.key),data:()=>data,ref:r};
   },set:(r,data)=>writes.push([r.key,data])});
   if([...reads].some(([key,v])=>(versions.get(key)||0)!==v))continue;
   for(const [key,data] of writes){const before=docs.get(key)||{},after={...before};for(const [field,value] of Object.entries(data))after[field]=value&&value.increment!==undefined?(Number(before[field])||0)+value.increment:value;docs.set(key,after);versions.set(key,(versions.get(key)||0)+1)}
   pending.push(writes);return;
  }
  throw Error('Demasiados conflictos');
 }};
 const context={firebaseDb:()=>firestore,orderUserKey:()=> 'usuario',orderProviderKey:o=>String(o.proveedor||''),orderHasContent:o=>Boolean(o.detalles?.length),orderSyncFields:()=>({syncId:1}),PEDIDOS_MONTH_TOTALS_COLLECTION:'totals',firebase:{firestore:{FieldValue:{serverTimestamp:()=>1,increment:n=>({increment:n})}}},orderMonthlyContribution:o=>o&&!o.eliminado&&o.confirmado?{month:'2026-10',branch:'7',amount:o.total||0}:null};
 vm.createContext(context);vm.runInContext(fn,context);
 return {docs,context,firestore,write:(id,payload,options)=>context.setOrderWithMonthlyTotal(id,payload,options),save:(payload,options={})=>context.setOrderWithMonthlyTotal(String(payload.id),payload,{uniqueOrderNumber:true,...options})};
}
const order=(proveedor,total=10)=>({id:'171',proveedor,total,confirmado:true,detalles:[{cantidad:1}]});
test('mismo número y proveedor de otro usuario reemplaza y no duplica el total',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:200},'pedidos/171__ana':order('A',10),'pedidos/171__juan':order('A',20),'totals/2026-10':{initialized:true,'7':30}});
 await h.save(order('A',15),{sameNumberDocIds:['171__ana','171__juan']});
 await h.save(order('A',18),{sameNumberDocIds:['171__ana','171__juan']});
 assert.equal(h.docs.get('pedidos/171').total,18);assert.equal(h.docs.get('totals/2026-10')['7'],18);assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,200);
 assert.equal([...h.docs.entries()].filter(([k,v])=>k.startsWith('pedidos/')&&!v.eliminado).length,1);
});
test('otro proveedor que ocupó el número mientras se confirmaba queda intacto',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:171},'pedidos/171':order('A',10)});
 const saved=await h.save(order('B',25));assert.equal(saved.id,'172');assert.equal(h.docs.get('pedidos/171').proveedor,'A');assert.equal(h.docs.get('pedidos/172').proveedor,'B');
});
test('conflicto histórico de otro proveedor asigna nuevo número sin tocarlo',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:200},'pedidos/171__ana':order('A')});
 const saved=await h.save(order('B'),{numberOccupiedByOtherProvider:true,observedMax:200});assert.equal(saved.id,'201');assert.equal(h.docs.get('pedidos/171__ana').proveedor,'A');assert.ok(!h.docs.get('pedidos/171__ana').eliminado);
});
test('no elimina un documento que pertenece a otro proveedor aunque llegue en candidatos',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:171},'pedidos/171__otro':order('B')});await h.save(order('A'),{sameNumberDocIds:['171__otro']});assert.ok(!h.docs.get('pedidos/171__otro').eliminado);
});
test('el borrado normal conserva su comportamiento',async()=>{
 const h=harness({'pedidos/171__ana':order('A')});await h.write('171__ana',{eliminado:true,confirmado:false,detalles:[]});assert.equal(h.docs.get('pedidos/171__ana').eliminado,true);assert.equal(h.docs.get('pedidos/171__ana').total,10);
});

test('pedido nuevo usa máximo global + 1, documento numérico y usuario separado',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:182},'pedidos/171':order('A')});
 const saved=await h.write('',{...order('A'),usuarioId:'Lautaro'},{allocateOrderNumber:true,confirmationToken:'draft1'});
 assert.equal(saved.id,'183');assert.equal(saved._docId,'183');assert.equal(h.docs.get('pedidos/183').usuarioId,'Lautaro');
 assert.equal(h.docs.get('pedidos/171').total,10);assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,183);
});
test('dos confirmaciones simultáneas del mismo número provisional reciben números diferentes',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:182},'totals/2026-10':{initialized:true,'7':0}});
 const results=await Promise.all(['Ana','Juan'].map(usuarioId=>h.write('',{...order('A'),usuarioId},{allocateOrderNumber:true,confirmationToken:usuarioId})));
 assert.deepEqual(results.map(o=>o.id).sort(),['183','184']);assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,184);
 assert.equal(h.docs.get('totals/2026-10')['7'],20);
});
test('reintento después de guardar sin recibir respuesta reutiliza número y no duplica consumo',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:182},'totals/2026-10':{initialized:true,'7':0}});
 const options={allocateOrderNumber:true,confirmationToken:'misma-confirmacion'};
 const first=await h.write('',order('A',15),options),retry=await h.write('',order('A',18),options);
 assert.equal(first.id,retry.id);assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,183);
 assert.equal(h.docs.get('totals/2026-10')['7'],18);assert.equal(h.docs.get('pedidos/183').total,18);
});
test('editar pedido histórico mantiene referencia, enlace compartido y total mensual',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:182},'pedidos/171__ana':{...order('A'),shareSlug:'enlace-original',revisionLock:{usuarioKey:'Ana'}},'totals/2026-10':{initialized:true,'7':10}});
 const saved=await h.write('171__ana',order('A',25),{requireExisting:true});
 assert.equal(saved._docId,'171__ana');assert.equal(h.docs.get('pedidos/171__ana').shareSlug,'enlace-original');
 assert.equal(h.docs.get('totals/2026-10')['7'],25);assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,182);assert.ok(!h.docs.has('pedidos/171'));
});
test('editar pedido numérico conserva su número aunque otro usuario lo confirme',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:200},'pedidos/183':{...order('A'),id:'183',usuarioId:'Ana'}});
 const saved=await h.write('183',{...order('A'),id:'183',usuarioId:'Juan'},{requireExisting:true});
 assert.equal(saved.id,'183');assert.equal(h.docs.get('pedidos/183').usuarioId,'Juan');assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,200);
});
test('no restaura una edición eliminada ni pisa un número ocupado con contador atrasado',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:182},'pedidos/183':{...order('A'),eliminado:true}});
 await assert.rejects(h.write('183',order('A'),{requireExisting:true}),/eliminado/);
 await assert.rejects(h.write('',order('A'),{allocateOrderNumber:true}),/ocupado/);
 assert.equal(h.docs.get('pedidos/183').eliminado,true);assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,182);
});
test('máximo observado del historial protege un contador atrasado',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:170}});
 const saved=await h.write('',order('A'),{allocateOrderNumber:true,observedMax:190});assert.equal(saved.id,'191');
});
test('cancelar o reintentar pedido ya eliminado no crea otro con su misma confirmación',async()=>{
 const h=harness({'configuracion/pedidoConfirmacion_x':{pedidoDocId:'183'},'pedidos/183':{...order('A'),eliminado:true}});
 await assert.rejects(h.write('',order('A'),{allocateOrderNumber:true,confirmationToken:'x'}),/disponible/);assert.equal(h.docs.size,2);
});

function confirmationHarness(initial={}){
 const h=harness(initial),c=h.context;
 Object.assign(c,{
  editingConfirmedDraftDocId:'',editingConfirmedDraftId:'',activeOrderDocId:'',allRemoteOrders:[],orderList:[],
  els:{orderNumber:{value:'171'}},window:{CorralonCacheDB:{get:async()=>0}},ORDER_SYNC_CURSOR_KEY:'cursor',
  ensureOrderNumberCounter:async()=>{},localDraftKey:()=> '171__local',maxOrderNumberFrom:orders=>Math.max(0,...orders.map(o=>Number(o.id)||0)),
  stopTopProgress:()=>{},show:()=>{},orderSyncFields:()=>({syncId:2}),
  saveLocal:async()=>{},removeLocalDraftsForOrder:async key=>{h.removedKey=key},
  upsertOrderList:o=>c.orderList.push(o),mergeRemoteOrderChanges:(old,changes)=>[...old.filter(o=>!changes.some(n=>n._docId===o._docId)),...changes],
  writeOrderRemoteCache:async orders=>{h.cache=orders},invalidateMonthlyPedidosCache:()=>{}
 });
 vm.runInContext(source.slice(source.indexOf('async function saveConfirmedPayloadRemote('),source.indexOf('async function saveRemote(){')),c);
 return h;
}
test('flujo real de confirmación nuevo asigna número global, guarda identidad y limpia solo borrador de origen',async()=>{
 const h=confirmationHarness({'configuracion/pedidosNumeracion':{ultimoNumero:182},'pedidos/171':order('A')});
 const saved=await h.context.saveConfirmedPayloadRemote({...order('A'),confirmationToken:'nuevo',_docId:''});
 assert.equal(saved.id,'183');assert.equal(h.context.activeOrderDocId,'183');assert.equal(h.context.els.orderNumber.value,'183');
 assert.equal(h.removedKey,'171__local');assert.equal(h.cache[0]._docId,'183');assert.equal(h.docs.get('pedidos/171').total,10);
 const retry=await h.context.saveConfirmedPayloadRemote({...order('A',20),confirmationToken:'nuevo',_docId:'183'},'183');
 assert.equal(retry.id,'183');assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,183);
});
test('flujo real de edición conserva doc histórico y enlaces sin migrar documentos',async()=>{
 const h=confirmationHarness({'configuracion/pedidosNumeracion':{ultimoNumero:182},'pedidos/171__ana':{...order('A'),shareSlug:'original'}});
 h.context.editingConfirmedDraftDocId='171__ana';h.context.editingConfirmedDraftId='171';
 const saved=await h.context.saveConfirmedPayloadRemote(order('A',25),'171__ana');
 assert.equal(saved._docId,'171__ana');assert.equal(h.docs.get('pedidos/171__ana').shareSlug,'original');assert.equal(h.docs.size,2);
});
test('inicialización considera pedidos históricos fuera de la caché y no reduce el contador',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:182}}),c=h.context;
 c.maxOrderNumberFrom=orders=>Math.max(0,...orders.map(o=>Number(o.id)||0));
 const collection=h.firestore.collection;
 h.firestore.collection=name=>({...collection(name),get:async()=>({docs:[{data:()=>({id:'195'})}]})});
 vm.runInContext(source.slice(source.indexOf('async function ensureOrderNumberCounter('),source.indexOf('async function setOrderWithMonthlyTotal(')),c);
 await c.ensureOrderNumberCounter();assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,195);assert.equal(h.docs.get('configuracion/pedidosNumeracion').numeracionGlobalVersion,1);
 // Ya validado: no vuelve a descargar el historial.
 h.firestore.collection=name=>({...collection(name),get:async()=>{throw Error('Consulta histórica repetida')}});
 await c.ensureOrderNumberCounter();
});
test('Cargar stock comparte contador con Pedidos y conserva la protección contra doble envío',async()=>{
 const h=harness({'configuracion/pedidosNumeracion':{ultimoNumero:182},'totals/2026-10':{initialized:true,'7':0}}),c=h.context;
 const stock=fs.readFileSync('respaldo/cargastock.html','utf8'),start=stock.indexOf('    await runTransaction(db,async transaction=>{',stock.indexOf('const sourceRef=doc(db,'));
 const end=stock.indexOf('    stockIngresoMessage(already?',start);
 assert.ok(start>0&&end>start);
 Object.assign(c,{db:{},sourceRef:h.firestore.collection('configuracion').doc('stockPedido_compra'),counterRef:h.firestore.collection('configuracion').doc('pedidosNumeracion'),summaryRef:h.firestore.collection('totals').doc('2026-10'),runTransaction:(_,cb)=>h.firestore.runTransaction(tx=>cb({set:tx.set,get:async r=>{const snap=await tx.get(r);return{...snap,exists:()=>snap.exists}}})),doc:(_,name,id)=>h.firestore.collection(name).doc(id),observedMax:0,actor:{id:'Lautaro',nombre:'Lautaro'},branch:'7',branchInfo:{label:'Sucursal'},current:{id_proveedor:'5686',proveedor:'ANSILTA'},movement:{fecha:'2026-10-16',nota:''},details:[{cantidad:1}],total:10,source:'compra',sourceContext:{confirmedNumber:123},serverTimestamp:()=>1,increment:n=>({increment:n})});
 vm.runInContext(`async function sendStock(){let savedNumber='',already=false;${stock.slice(start,end)}return {savedNumber,already}}`,c);
 const results=await Promise.all([c.sendStock(),h.write('',order('B'),{allocateOrderNumber:true,confirmationToken:'pedido'})]);
 assert.deepEqual([results[0].savedNumber,results[1].id].sort(),['183','184']);
 const again=await c.sendStock();assert.equal(again.already,true);assert.equal(again.savedNumber,results[0].savedNumber);
 assert.equal(h.docs.get('configuracion/pedidosNumeracion').ultimoNumero,184);assert.equal(h.docs.get('totals/2026-10')['7'],20);
 assert.ok([...h.docs.keys()].filter(k=>k.startsWith('pedidos/')).every(k=>/^pedidos\/\d+$/.test(k)));
});

test('borrador recuperado sin documento remoto no se confunde con pedido confirmado',()=>{
 const c={orderUserKey:()=> 'Lautaro',orderId:()=> '171',orderDisplayNumber:o=>String(o.id||''),isBlank:()=>false,orderUserName:()=> 'Lautaro'};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function localDraftKey('),source.indexOf('function localDraftOrder(')),c);
 const local=c.localDraftToOrder({header:{id:'171',confirmationToken:'token-persistido'},rows:[{cantidad:1}]});
 const editing=c.localDraftToOrder({header:{id:'171',_docId:'171__Lautaro'},rows:[{cantidad:1}]});
 assert.equal(local._localOnly,true);assert.equal(local.confirmationToken,'token-persistido');assert.equal(editing._localOnly,false);
 // loadOrder conserva el ID remoto solo cuando realmente estaba guardado.
 const load=source.slice(source.indexOf('function loadOrder('),source.indexOf('async function deleteRemoteBlankOrders('));
 assert.ok(load.includes("activeOrderDocId=order?._localOnly?'':"));
 const confirm=source.slice(source.indexOf('async function confirmCurrentOrder('),source.indexOf("els.reviewOrderBtn.addEventListener"));
 assert.ok(confirm.includes("const lockDocId=String(editingConfirmedDraftDocId||activeOrderDocId||'').trim()"));
 assert.ok(!confirm.includes('resolveOrderDocId('));
});
