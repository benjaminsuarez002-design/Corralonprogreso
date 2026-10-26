const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const records=new Map();let queue=Promise.resolve();
 const db={objectStoreNames:{contains:()=>true},transaction(){
  const operations=[],tx={objectStore:()=>({get(key){const request={};operations.push(()=>{request.result=records.get(key);request.onsuccess?.();});return request;},put(row){operations.push(()=>records.set(row.key,row));},delete(key){operations.push(()=>records.delete(key));}})};
  queue=queue.then(()=>{for(const operation of operations)operation();tx.oncomplete?.();});return tx;
 }};
 function tab(){const box={console,navigator:{},setInterval,clearInterval,setTimeout:(fn)=>setTimeout(fn,1),window:{indexedDB:{open(){const request={};setImmediate(()=>{request.result=db;request.onsuccess();});return request;}}}};
  vm.createContext(box);vm.runInContext(fs.readFileSync('corralon-cache-db.js','utf8'),box);return box.window.CorralonCacheDB;}
 return {records,tab};
}
test('la caché pública coordina cinco pestañas HTTP con un bloqueo IndexedDB',async()=>{
 const s=setup();let downloads=0;
 await Promise.all(Array.from({length:5},()=>{const cache=s.tab();return cache.withLock('public-responses',async()=>{if(await cache.get('response'))return;downloads++;await new Promise(resolve=>setTimeout(resolve,10));await cache.set('response',['articulo']);});}));
 assert.equal(downloads,1);assert.equal(s.records.size,1);assert.deepEqual(Array.from(await s.tab().get('response')),['articulo']);
});
test('fallos liberan el bloqueo y una pestaña cerrada no lo retiene para siempre',async()=>{
 const s=setup(),cache=s.tab();await assert.rejects(cache.withLock('rubros',async()=>{throw Error('Offline')}),/Offline/);assert.equal(s.records.size,0);
 s.records.set('__lease|rubros',{key:'__lease|rubros',owner:'cerrada',expiresAt:1});
 assert.equal(await cache.withLock('rubros',async()=>42),42);assert.equal(s.records.size,0);
});
