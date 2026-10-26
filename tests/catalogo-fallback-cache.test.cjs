const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('corralon-system.js','utf8');
const start=source.indexOf('  const CATALOG_REALTIME = (() => {'),end=source.indexOf('\n  })();',start)+9;
const code=source.slice(start,end).replace(/Promise\.all\(\[import\('[^']+'\),import\('[^']+'\)\]\)/,'Promise.resolve([apps,firestore])');
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup(){
 const store=new Map(),listeners=[];let reads=0,queue=Promise.resolve();
 function tab(){const events=[],handlers=new Map(),box={console,navigator:{},IS_AUTOMATED_CRAWLER:false,SUPABASE_URL:'https://test',SUPABASE_KEY:'test',TABLES:{catalogMeta:'meta'},headers:()=>({}),setTimeout,clearTimeout,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
   document:{baseURI:'http://test'},window:{addEventListener:(name,fn)=>handlers.set(name,fn),dispatchEvent:e=>events.push(e)},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
   CATALOG:{refresh:async()=>{},withDownloadLock(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task;}},
   apps:{getApps:()=>[{options:{projectId:'corralon-progreso'}}]},firestore:{getFirestore:()=>({}),doc:()=>({}),onSnapshot:(ref,next)=>listeners.push(next)},
   fetch:async()=>{reads++;await flush();return {ok:true,json:async()=>[{version:4,patch_version:2,ranking_version:1}]};}};
  vm.createContext(box);vm.runInContext(code+';globalThis.api=CATALOG_REALTIME;',box);return {box,events,handlers};}
 return {tab,store,get reads(){return reads},signal(n,fromCache=false){for(const next of listeners)next({metadata:{fromCache},exists:()=>true,data:()=>({version:n})});}};
}
test('HTTP sin SharedWorker: cinco pestañas y diez reentradas consultan metadata solo una vez',async()=>{
 const s=setup(),tabs=Array.from({length:5},()=>s.tab()),promises=tabs.map(t=>t.box.api.getMeta());await flush();s.signal(10);await Promise.all(promises);assert.equal(s.reads,1);
 s.signal(10);await flush();assert.equal(s.reads,1);assert(tabs.every(t=>t.events.length===1));
 for(let i=0;i<10;i++){const t=s.tab(),pending=t.box.api.getMeta();await flush();s.signal(10);await pending;}
 assert.equal(s.reads,1);
 s.signal(11);await flush();await flush();assert.equal(s.reads,2);
});
test('un snapshot local no habilita una respuesta persistida sin verificar Firebase',async()=>{
 const s=setup();s.store.set('corralon_catalog_firebase_meta_v1',JSON.stringify({url:'https://test',signalVersion:10,meta:{version:4,patch_version:2}}));
 const t=s.tab();let resolved=false;const pending=t.box.api.getMeta().then(()=>resolved=true);await flush();s.signal(10,true);await flush();assert.equal(resolved,false);assert.equal(s.reads,0);
 s.signal(10);await pending;assert.equal(s.reads,0);
});
