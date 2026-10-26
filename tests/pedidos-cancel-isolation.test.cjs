const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('pedidos.html','utf8');
function line(name){const result=source.split('\n').find(l=>l.includes('function '+name+'('));assert.ok(result,name);if(name==='counterOrders')return source.slice(source.indexOf('function counterOrders('),source.indexOf('function updateOrderCounter('));return result;}
function setup(){
 const s={canceledOrderKeys:new Set(),orderList:[],localOrderDrafts:new Map(),orderListKey:o=>o._docId,orderHasContent:o=>!!o.detalles?.length,orderBelongsToActiveUser:()=>true,localDraftToOrder:d=>d.order,editingConfirmedDraftDocId:'',orderStatus:o=>o.estadoPedido,orderRevisionOwnedByActiveUser:()=>true};
 vm.createContext(s);for(const name of ['normalizeOrderList','pendingOrders','confirmedOrders','counterOrders','upsertOrderList'])vm.runInContext(line(name),s);s.updateOrderCounter=()=>{};return s;
}
test('cancelar un documento no oculta otro con el mismo número ni lo elimina de historial',()=>{
 const s=setup(),a={id:'185',_docId:'185__usuario',detalles:[{articulo:'A'}]},b={id:'185',_docId:'185',confirmado:true,estadoPedido:'revision',detalles:[{articulo:'B'}]};
 s.orderList=[a,b];s.canceledOrderKeys.add(a._docId);s.localOrderDrafts.set(a._docId,{order:a});s.localOrderDrafts.set(b._docId,{order:b,header:{_editingConfirmedDraftDocId:b._docId}});
 assert.equal(s.confirmedOrders().length,1);assert.equal(s.confirmedOrders()[0]._docId,'185');
 assert.equal(s.counterOrders().length,1);assert.equal(s.counterOrders()[0]._docId,'185');
 s.upsertOrderList({...b,nota:'Conservado'});assert.equal(s.orderList.length,1);assert.equal(s.orderList[0].nota,'Conservado');
});
test('cancelar el primero carga el segundo y crear un pedido después conserva su borrador',async()=>{
 const s=setup(),a={id:'185',_docId:'185__usuario',detalles:[{articulo:'A'}]},b={id:'185',_docId:'185',detalles:[{articulo:'B'}]};s.orderList=[a,b];s.localOrderDrafts.set(a._docId,{order:a});s.localOrderDrafts.set(b._docId,{order:b});
 Object.assign(s,{confirm:()=>true,clearTimeout(){},saveTimer:null,orderId:()=>a.id,currentOrderListKey:()=>a._docId,currentOrderSnapshot:()=>a,unmarkFaltantesForOrder:async()=>{},removeLocalDraft:async key=>s.localOrderDrafts.delete(key),allRemoteOrders:[],pendingRows:new Set(),paintRowSyncState(){},els:{status:{}},loadOrder:o=>{s.loaded=o},saveLocal:async()=>{s.saved=structuredClone([...s.localOrderDrafts])},newBlankOrder:async()=>{s.blank=true},openSuggestionsForNewOrder:async()=>{},show:assert.fail,console});
 const start=source.indexOf('async function cancelCurrentOrder('),end=source.indexOf('\nels.cancelOrderBtn.addEventListener',start);vm.runInContext(source.slice(start,end),s);
 await s.cancelCurrentOrder();assert.equal(s.loaded._docId,b._docId);assert.equal(s.blank,undefined);assert.equal(s.localOrderDrafts.size,1);assert.equal(s.saved[0][0],b._docId);
 await s.newBlankOrder();assert.equal(s.localOrderDrafts.get(b._docId).order.detalles[0].articulo,'B');
});
test('nuevo borrador no reutiliza el número de uno cancelado',()=>{
 const s=setup();Object.assign(s,{ORDER_COUNTER_LOCAL_KEY:'counter',localStorage:{getItem:()=> '185',setItem(){}},maxOrderNumberFrom:()=>184,allRemoteOrders:[]});vm.runInContext(line('nextOrderNumber'),s);assert.equal(s.nextOrderNumber(),186);
});
