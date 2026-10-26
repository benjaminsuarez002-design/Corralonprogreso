const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','gestion.html'),'utf8');
function storeContext(initial=[],delayFirst=false){
  const records=new Map(initial.map(d=>[d.id,structuredClone(d)]));
  let opens=0,releaseFirst;
  function database(){return {close(){},transaction(){
    const tx={};
    tx.objectStore=()=>({get(id){const request={};queueMicrotask(()=>{request.result=structuredClone(records.get(id));request.onsuccess();queueMicrotask(()=>tx.oncomplete());});return request;},put(d){records.set(d.id,structuredClone(d));}});
    return tx;
  }};}
  const context=vm.createContext({structuredClone,STORE:'borradores',openDB:async()=>{opens++;if(delayFirst&&opens===1)await new Promise(resolve=>releaseFirst=resolve);return database();}});
  vm.runInContext(html.slice(html.indexOf('let draftWriteQueue='),html.indexOf('async function allDrafts()')),context);
  return {context,records,get opens(){return opens},release:()=>releaseFirst()};
}
test('un guardado lento no puede terminar después de la confirmación y borrar su marca',async()=>{
  const s=storeContext([],true);
  const draft={id:'venta',updatedAt:1,emision:null,cliente:{nombre:'PAGAN'}};
  const old=s.context.putDraft(draft);
  await new Promise(setImmediate);
  draft.cliente.nombre='CAMBIO POSTERIOR';
  const issued=s.context.putDraft({id:'venta',updatedAt:2,emision:{idRecibo:496894},cliente:{nombre:'PAGAN'}});
  await new Promise(setImmediate);
  assert.equal(s.opens,1,'El siguiente guardado debe esperar al anterior');
  s.release();
  const first=await old;await issued;
  assert.equal(first.cliente.nombre,'PAGAN','La copia no debe conservar referencias editables');
  assert.equal(s.records.get('venta').emision.idRecibo,496894);
});
test('una pestaña vieja no puede reemplazar una venta emitida por otro borrador',async()=>{
  const saved={id:'venta',updatedAt:2,emision:{idRecibo:496894},cliente:{nombre:'PAGAN'}};
  const s=storeContext([saved]);
  const result=await s.context.putDraft({id:'venta',updatedAt:3,emision:null,cliente:{nombre:'FERNANDEZ'}});
  assert.equal(result.cliente.nombre,'PAGAN');assert.deepEqual(s.records.get('venta'),saved);
});
test('una copia anterior no reemplaza el contenido más reciente del borrador',async()=>{
  const saved={id:'venta',updatedAt:20,emision:null,cliente:{nombre:'NUEVO'}};
  const s=storeContext([saved]);await s.context.putDraft({id:'venta',updatedAt:10,emision:null,cliente:{nombre:'VIEJO'}});
  assert.deepEqual(s.records.get('venta'),saved);
});
const draft={id:'8d2bae3d-01e4-4488-b07a-0e760481858d',idComprobante:13,emision:null,recoveryPending:false};
for(const [state,pending] of [['emitido',true],['pendiente',true],['sinRegistro',false]])test(`restaurar ${state} ${pending?'bloquea edición':'permite retomar'} sin cambiar ID`,async()=>{
  const urls=[];
  const context=vm.createContext({SQL_PREPARACION:'/api/facturacion',fetch:async url=>{urls.push(url);return {ok:true,json:async()=>({ok:true,estado:state})}},console});
  vm.runInContext(html.slice(html.indexOf('async function prepareRestoredDraft('),html.indexOf('async function restoreLastLocalState(')),context);
  const result=await context.prepareRestoredDraft(structuredClone(draft));
  assert.equal(result.id,draft.id);assert.equal(result.recoveryPending,pending);assert.match(urls[0],/soloSql=1/);
});
test('si SQL no responde conserva el borrador y no habilita emisión sin comprobarlo',async()=>{
  const context=vm.createContext({SQL_PREPARACION:'/api/facturacion',fetch:async()=>{throw new Error('sin conexión')},console:{warn(){}}});
  vm.runInContext(html.slice(html.indexOf('async function prepareRestoredDraft('),html.indexOf('async function restoreLastLocalState(')),context);
  const result=await context.prepareRestoredDraft(structuredClone(draft));
  assert.equal(result.id,draft.id);assert.equal(result.recoveryPending,true);
});
