const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const code=source.slice(source.indexOf('const indexPublicRequests ='),source.indexOf('function reemplazarCatalogoPublico'));
function setup(){
  const records=new Map(),queues=new Map();let requests=0,version=1,patch=1,fail=false;
  const cache={get:async key=>records.get(key),set:async(k,v)=>records.set(k,v),updateMany:async(entries,removed)=>{entries.forEach(([k,v])=>records.set(k,v));removed.forEach(k=>records.delete(k));},
    withLock(key,fn){const task=(queues.get(key)||Promise.resolve()).then(fn);queues.set(key,task.catch(()=>{}));return task;}};
  function tab(){const box={console,Date,Map,Set,JSON,SUPABASE_URL:'https://test',SUPABASE_ANON_KEY:'test',
    window:{CorralonCacheDB:cache,CorralonSystem:{catalogRealtime:{getMeta:async()=>({version,patch_version:patch})},catalog:{fromSupabase:row=>row}}},
    fetch:async(url,options)=>{requests++;await new Promise(resolve=>setImmediate(resolve));return {ok:!fail,text:async()=>'offline',json:async()=>[{codigo:JSON.parse(options.body).p_termino||'portada',precio_venta:version}]};}};
    vm.createContext(box);vm.runInContext(code+';globalThis.search=consultarCatalogoPublicoReducido;globalThis.cached=indexCachedPublicRequest;',box);return box;}
  return {tab,records,get requests(){return requests},change(){version++;patch++;},patch(){patch++;},fail(value){fail=value;}};
}
test('diez entradas y veinte búsquedas iguales reutilizan respuestas verificadas',async()=>{
  const s=setup();
  for(let i=0;i<10;i++){const tab=s.tab();await tab.search({portada:true});await tab.search({termino:'cemento'});await tab.search({termino:'cemento'});}
  assert.equal(s.requests,2,'solo una portada y una búsqueda, no por artículo ni por visita');
});
test('cinco pestañas nuevas comparten una descarga pública',async()=>{
  const s=setup();await Promise.all(Array.from({length:5},()=>s.tab().search({termino:'arena'})));assert.equal(s.requests,1);
});
test('una versión o parche nuevo invalida la respuesta; ranking no pertenece a esta firma',async()=>{
  const s=setup(),tab=s.tab();await tab.search({termino:'arena'});s.change();await tab.search({termino:'arena'});s.patch();await tab.search({termino:'arena'});assert.equal(s.requests,3);
});
test('un fallo no queda guardado como búsqueda vacía ni bloquea el reintento',async()=>{
  const s=setup(),tab=s.tab();s.fail(true);await assert.rejects(tab.search({termino:'arena'}),/offline/);s.fail(false);assert.equal((await tab.search({termino:'arena'})).length,1);assert.equal(s.requests,2);
});
test('la caché persistida conserva como máximo cuarenta respuestas',async()=>{
  const s=setup(),tab=s.tab();for(let i=0;i<50;i++)await tab.search({termino:'q'+i});assert.equal(s.records.size,41);assert.equal(s.records.get('index_public_response_keys_v1').length,40);
});
test('rubros sobreviven otra visita y se descargan de nuevo solo con cambio',async()=>{
  const rubricCode=source.slice(source.indexOf('let indexRubrosLoading=null;'),source.indexOf('function indexExitRubrosView'));
  const records=new Map();let requests=0,version=1;
  function tab(){const box={console,Set,Date,URL,SUPABASE_URL:'https://test',INDEX_MENU_SESSION_ACTIVE:false,todosArticulos:[],indexRubrosKnown:new Set(),
    CorralonSystem:{headers:()=>({})},window:{CorralonSystem:{catalog:{cachedRows:async()=>[]},catalogRealtime:{getMeta:async()=>({version,patch_version:1})}},CorralonCacheDB:{get:async k=>records.get(k),set:async(k,v)=>records.set(k,v),withLock:async(k,fn)=>fn()}},
    fetch:async()=>{requests++;return {ok:true,json:async()=>[{rubro:'PEGAMENTOS'},{rubro:'CERAMICOS'}]}}};vm.createContext(box);vm.runInContext(rubricCode+';globalThis.load=indexLoadRubros;',box);return box;}
  await tab().load();const reopened=tab();await reopened.load();assert.equal(requests,1);assert.equal(reopened.indexRubrosKnown.size,2);version++;await tab().load();assert.equal(requests,2);
  assert(source.indexOf('src="corralon-cache-db.js"')<source.indexOf('src="corralon-system.js'));
});
test('Index no pierde un cambio recibido mientras actualiza la portada',async()=>{
  const updateCode=source.slice(source.indexOf('let publicCatalogPendingMeta ='),source.indexOf('function iniciarConsultaVersionCatalogoPublico'));
  let finish,downloads=0;const meta={version:1,patch_version:1};
  const box={console,INDEX_MENU_SESSION_ACTIVE:false,document:{hidden:false},publicCatalogVersionChecking:false,publicCatalogVersion:'1|1',
    indexPublicRequests:new Map(),cacheBusquedaPublica:new Map(),indexCategoryCache:new Map(),indexRubrosKnown:new Set(),
    indexRubrosLoading:null,ceramicoBudgetGlueCatalogo:null,indexCategoryActive:'',indexFavoritesActive:false,terminoBaseBusquedaPublica:'',
    window:{CorralonSystem:{catalogRealtime:{getMeta:async()=>meta}},CorralonCacheDB:{set:async()=>{}}},
    codigosPrioritariosCatalogoInicio:()=>[],reemplazarCatalogoPublico(){},consultarCatalogoPublicoReducido:async()=>{downloads++;if(downloads===1)await new Promise(resolve=>finish=resolve);return [];}};
  vm.createContext(box);vm.runInContext(updateCode+';globalThis.update=comprobarVersionCatalogoPublico;',box);
  await box.update(meta);assert.equal(downloads,0,'misma versión no recarga artículos');
  const first=box.update({version:2,patch_version:2});await box.update({version:3,patch_version:3});finish();await first;
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(downloads,2);assert.equal(box.publicCatalogVersion,'3|3');
});
