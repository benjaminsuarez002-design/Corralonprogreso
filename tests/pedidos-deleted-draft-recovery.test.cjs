const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('pedidos.html','utf8');
const fn=source.slice(source.indexOf('async function saveConfirmedPayloadRemote('),source.indexOf('async function saveRemote()',source.indexOf('async function saveConfirmedPayloadRemote(')));
function setup(answer){
 const writes=[],removed=[],messages=[];
 const s={editingConfirmedDraftDocId:'deleted-doc',editingConfirmedDraftId:'188',editingOriginalEstado:'espera',activeOrderDocId:'deleted-doc',orderConfirmationToken:'old-token',
 firebaseDb:()=>({collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({id:'188',eliminado:true})})})})}),localDraftKey:()=> 'deleted-doc',askPageQuestion:async()=>answer,
 globalThis:{crypto:{randomUUID:()=> 'new-token'}},els:{orderNumber:{value:'188'}},orderId:()=>s.els.orderNumber.value,nextOrderNumber:()=>189,
 paint(){s.painted=true;},updateOrderCounter(){},saveLocal:async()=>{},orderProviderKey:()=> 'provider',ensureOrderNumberCounter:async()=>{},orderSyncFields:()=>({syncId:1}),allRemoteOrders:[],maxOrderNumberFrom:()=>188,
 setOrderWithMonthlyTotal:async(id,payload,options)=>{writes.push({id,payload,options});return {...payload,id:'190',_docId:'190'};},upsertOrderList(){},removeLocalDraftsForOrder:async id=>removed.push(id),mergeRemoteOrderChanges:(old,changes)=>changes,
 window:{CorralonCacheDB:{get:async()=>0}},ORDER_SYNC_CURSOR_KEY:'cursor',writeOrderRemoteCache:async()=>{},invalidateMonthlyPedidosCache(){},stopTopProgress:message=>messages.push(message),show:message=>messages.push(message),console};
 vm.createContext(s);vm.runInContext(fn,s);return {s,writes,removed,messages};
}
const payload={id:'188',_docId:'deleted-doc',confirmationToken:'old-token',proveedor:'P',nota:'Conservar nota',detalles:[{articulo:'A',cantidad:3}]};
test('pedido eliminado: aceptar conserva el contenido y asigna identidad nueva sin restaurar el eliminado',async()=>{
 const h=setup(true),saved=await h.s.saveConfirmedPayloadRemote(payload,'deleted-doc');assert.equal(saved.id,'190');assert.equal(saved._recoveredDeletedDraft,true);assert.equal(h.s.painted,true);assert.equal(h.writes.length,1);
 const w=h.writes[0];assert.equal(w.id,'');assert.equal(w.options.allocateOrderNumber,true);assert.equal(w.options.requireExisting,false);assert.equal(w.options.confirmationToken,'new-token');assert.equal(w.payload.nota,payload.nota);assert.deepEqual(w.payload.detalles,payload.detalles);assert.equal(h.s.editingConfirmedDraftDocId,'');assert.equal(h.s.activeOrderDocId,'190');assert(h.removed.includes('deleted-doc'));
});
test('pedido eliminado: cancelar conserva borrador y no escribe ni borra nada',async()=>{
 const h=setup(false);assert.equal(await h.s.saveConfirmedPayloadRemote(payload,'deleted-doc'),null);assert.equal(h.writes.length,0);assert.equal(h.removed.length,0);assert.equal(h.s.activeOrderDocId,'deleted-doc');assert.equal(h.s.orderConfirmationToken,'old-token');
});

test('la recuperación muestra el pedido guardado al terminar en vez de limpiar la pantalla',()=>{
 assert.match(source,/if\(saved\._recoveredDeletedDraft\)\{loadOrder\(saved,\{focus:false\}\);paint\(\);updateOrderCounter\(\);\}\s*else await newBlankOrder\(\);/);
});
