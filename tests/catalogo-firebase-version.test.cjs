const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
function worker({fail=false,delay=false}={}){
 let listener,errorCallback,reads=0,subscriptions=0,unsubscriptions=0,remote=1,finish;
 const timers=[],events=[];
 const box={console,importScripts(){},clearTimeout(){},setTimeout(fn,ms){timers.push({fn,ms});return timers.length},
  firebase:{apps:[],initializeApp:()=>({firestore:()=>({doc:path=>{assert.equal(path,'configuracion/catalogo_version');return {onSnapshot(next,error){subscriptions++;listener=next;errorCallback=error;return ()=>{unsubscriptions++}}}}})})},
  fetch:async()=>{reads++;const version=remote;if(delay&&reads===1)await new Promise(resolve=>{finish=resolve});return {ok:!fail,status:503,json:async()=>[{version,patch_version:version,ranking_version:version}]}}
 };
 vm.createContext(box);vm.runInContext(fs.readFileSync('catalogo-realtime-worker.js','utf8'),box);
 function tab(savedMeta){const messages=[],port={start(){},close(){},postMessage:m=>messages.push(m)};box.onconnect({ports:[port]});port.onmessage({data:{type:'init',url:'https://test',key:'test',savedMeta}});return {messages,send:m=>port.onmessage({data:m})}}
 return {box,tab,timers,get reads(){return reads},get subscriptions(){return subscriptions},get unsubscriptions(){return unsubscriptions},finish:()=>finish(),signal(version,fromCache=false){remote=version;listener({exists:true,metadata:{fromCache},data:()=>({version})})}};
}
test('cinco pestañas escuchan un número Firebase; una consulta inicial y otra por cambio',async()=>{
 const s=worker(),tabs=Array.from({length:5},()=>s.tab());assert.equal(s.reads,0);assert.equal(s.subscriptions,1);
 s.signal(1);await flush();assert.equal(s.reads,1);
 for(const tab of tabs)await tab.send({type:'get-meta',requestId:1});assert.equal(s.reads,1);
 s.signal(1);await flush();assert.equal(s.reads,1,'mismo número/reconexión no descarga metadata');
 s.signal(2);await flush();assert.equal(s.reads,2);assert.equal(tabs[2].messages.at(-1).meta.version,2);
 await tabs[0].send({type:'cache-ready'});assert.equal(tabs[1].messages.at(-1).type,'cache-ready');
 assert(!fs.readFileSync('catalogo-realtime-worker.js','utf8').includes('postgres_changes'));
});
test('una versión nueva durante la consulta anterior se procesa después',async()=>{
 const s=worker({delay:true});const tab=s.tab();s.signal(1);await flush();s.signal(2);s.finish();await flush();assert.equal(s.reads,2);assert.equal(tab.messages.at(-1).meta.version,2);
});
test('fallo de metadata no dispara consultas desde cada pestaña',async()=>{
 const s=worker({fail:true}),tabs=[s.tab(),s.tab()];s.signal(1);await flush();for(const tab of tabs)await tab.send({type:'get-meta',requestId:1});assert.equal(s.reads,1);assert(tabs.every(t=>t.messages.at(-1).error));
});
test('snapshots de caché no disparan descargas y cerrar pestañas libera la escucha',async()=>{
 const s=worker(),tab=s.tab();s.signal(1,true);assert.equal(s.reads,0);s.signal(1);await flush();await tab.send({type:'release'});s.timers.find(t=>t.ms===10000).fn();assert.equal(s.unsubscriptions,1);
});
test('publicador incrementa solo el contador, sin lectura previa ni cambiar artículos',async()=>{
 const {publish}=require('../catalogo-version-publish.js');let calls=0;
 assert.equal(await publish(async(url,options)=>{calls++;assert(url.includes('documents:commit'));assert.equal(options.method,'POST');const payload=JSON.parse(options.body);assert.deepEqual(payload.writes[0].transform.fieldTransforms,[{fieldPath:'version',increment:{integerValue:'1'}}]);return {ok:true,json:async()=>({writeResults:[{transformResults:[{integerValue:'2'}]}]})}}),2);assert.equal(calls,1);
 await assert.rejects(publish(async()=>({ok:false,status:403,json:async()=>({error:{message:'Denied'}})})),/falló el aviso/);
});

test('volver a abrir conserva metadata si Firebase confirma el mismo contador',async()=>{
 const first=worker(),tab=first.tab();first.signal(8);await flush();
 const value=tab.messages.findLast(m=>m.type==='meta');
 const saved={url:'https://test',signalVersion:value.signalVersion,meta:value.meta};
 const reopened=worker(),next=reopened.tab(saved);reopened.signal(8,true);await flush();
 assert.equal(reopened.reads,0);assert(!next.messages.some(m=>m.type==='meta'),'no confiar en snapshot local');
 reopened.signal(8);await flush();assert.equal(reopened.reads,0);
 await next.send({type:'get-meta',requestId:2});assert.equal(next.messages.at(-1).meta.version,8);
 reopened.signal(9);await flush();assert.equal(reopened.reads,1);assert.equal(next.messages.at(-1).signalVersion,9);
});
test('caché de otro servidor o contador viejo no impide verificar un cambio',async()=>{
 for(const savedMeta of [{url:'https://other',signalVersion:5,meta:{version:5}},{url:'https://test',signalVersion:4,meta:{version:4}}]){
  const s=worker();s.tab(savedMeta);s.signal(5);await flush();assert.equal(s.reads,1);
 }
});
