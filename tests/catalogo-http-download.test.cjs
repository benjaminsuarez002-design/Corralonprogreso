const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('corralon-system.js','utf8');
const code=source.slice(source.indexOf('    let catalogLoadQueue ='),source.indexOf('    function startFullLoad('));
// Cola de transacciones readwrite compartida: como el mismo almacén de IndexedDB.
function database(){
 const records=new Map();let queue=Promise.resolve();
 return {records,transaction(){
  const requests=[];const tx={objectStore:()=>({get(key){const r={};requests.push(()=>{r.result=records.get(key);r.onsuccess()});return r},put(row){records.set(row.id,row)},delete(key){records.delete(key)}})};
  queue=queue.then(()=>{for(const run of requests)run();tx.oncomplete()});return tx;
 }};
}
function setup({failFirst=false,expired=false}={}){
 const db=database();if(expired)db.records.set('__catalog_download_lock_v1',{owner:'closed-tab',expiresAt:1});
 let cached={source:'supabase',version:1,patchVersion:1,rows:[{codigo:'1'}]},downloads=0;
 function tab(){
  const box={console,navigator:{},setTimeout:(fn)=>setTimeout(fn,1),setInterval,clearInterval,openCatalogDb:async()=>db,
   memoryCache:null,readCache:async()=>cached,cacheHasRubros:()=>true,CATALOG_REALTIME:{cacheReady(){}},window:{dispatchEvent(){}},CustomEvent:class{},
   canApplyPatches:c=>c.patchVersion>c.cached.patchVersion,
   startPatchLoad:async c=>{downloads++;await new Promise(resolve=>setTimeout(resolve,10));if(failFirst&&downloads===1)throw Error('Offline');cached={...cached,version:c.version,patchVersion:c.patchVersion};return cached.rows},
   canApplyDelta:()=>false,startDeltaLoad(){assert.fail('delta inesperado')},startFullLoad(){assert.fail('descarga completa inesperada')},alignCachedVersion:c=>c.cached.rows};
  vm.createContext(box);vm.runInContext(code+';globalThis.load=startCatalogLoad;',box);return box;
 }
 return {db,tab,get downloads(){return downloads},get cached(){return cached}};
}
test('HTTP sin Web Locks: ocho pestañas descargan una vez y reutilizan la caché',async()=>{
 const s=setup(),tabs=Array.from({length:8},()=>s.tab()),context={cached:s.cached,version:2,patchVersion:2};
 await Promise.all(tabs.map(t=>t.load(context)));assert.equal(s.downloads,1);assert.equal(s.cached.patchVersion,2);assert.equal(s.db.records.size,0);
 await Promise.all(tabs.map(t=>t.load(context)));assert.equal(s.downloads,1);
});
test('el fallo del primer propietario libera la descarga para otra pestaña',async()=>{
 const s=setup({failFirst:true}),tabs=[s.tab(),s.tab()],context={cached:s.cached,version:2,patchVersion:2};
 const results=await Promise.allSettled(tabs.map(t=>t.load(context)));assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(s.downloads,2);assert.equal(s.db.records.size,0);
});
test('un bloqueo vencido de una pestaña cerrada se recupera',async()=>{
 const s=setup({expired:true});await s.tab().load({cached:s.cached,version:2,patchVersion:2});assert.equal(s.downloads,1);assert.equal(s.db.records.size,0);
});
test('una pestaña no puede renovar ni liberar el bloqueo de otra',async()=>{
 const s=setup(),tab=s.tab();assert.equal(await tab.updateCatalogDownloadLease(s.db,'first','acquire'),true);
 assert.equal(await tab.updateCatalogDownloadLease(s.db,'second','acquire'),false);
 assert.equal(await tab.updateCatalogDownloadLease(s.db,'second','renew'),false);
 await tab.updateCatalogDownloadLease(s.db,'second','release');assert.equal(s.db.records.get('__catalog_download_lock_v1').owner,'first');
 await tab.updateCatalogDownloadLease(s.db,'first','release');assert.equal(s.db.records.size,0);
});
