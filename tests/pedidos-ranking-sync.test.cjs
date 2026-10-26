const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');

test('migra la cache anterior una vez y luego descarga sólo cambios de versión',async()=>{
 const dom=new JSDOM('<button id="rankingBtn"></button>',{url:'http://localhost/pedidos.html',runScripts:'outside-only'}),w=dom.window;
 const cached=new Map([['pedidos_ranking_articulos_4m_v1',{version:34,rows:[{idart:'1'}]}]]);
 const meta={ranking_version:34};const requests=[];
 const first={idart:'1',ventas_progreso:2,unidades_progreso:10,importe_progreso:10000,puntaje:.2,sync_version:34};
 const second={idart:'2',ventas_progreso:1,unidades_progreso:4,importe_progreso:1000,puntaje:.01,sync_version:34};
 w.CorralonCacheDB={get:async key=>cached.get(key),set:async(key,value)=>cached.set(key,value)};
 w.CorralonSystem={catalog:{load:async()=>[1,2].map(id=>({codigo:String(id),nombre:'Artículo '+id,stockSucursalProgresoRuta:0,stockSucursalCalle5Espana:0}))},catalogRealtime:{getMeta:async()=>meta},faltantes:{loadProviderNames:async()=>[]},headers:x=>x||{}};
 Object.defineProperty(w.navigator,'locks',{value:{request:async(_name,fn)=>fn()}});
 w.fetch=async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>requests.length===1?[first,second]:[{...first,puntaje:.4,sync_version:35}]}};
 try{
  w.eval(fs.readFileSync('pedidos.html','utf8').match(/<script id="pedidos-ranking-script">([\s\S]*?)<\/script>/)[1]);await w.CorralonPedidosRanking.openRanking();
  assert.equal(requests.length,1);assert.ok(requests[0].url.includes('importe_progreso,importe_calle5,puntaje'));assert.ok(!requests[0].url.includes('sync_version=gt.'));
  assert.equal(cached.get('pedidos_ranking_articulos_4m_v2').version,34);
  await w.CorralonPedidosRanking.sync(meta);assert.equal(requests.length,1);
  await w.CorralonPedidosRanking.sync({ranking_version:35});assert.equal(requests.length,2);
  assert.ok(requests[1].url.includes('sync_version=gt.34'));assert.ok(requests[1].url.includes('sync_version=lte.35'));
  const next=cached.get('pedidos_ranking_articulos_4m_v2');assert.equal(next.rows.length,2);
  assert.equal(next.rows.find(r=>r.idart==='1').puntaje,.4);assert.equal(next.rows.find(r=>r.idart==='2').puntaje,.01);
  await w.CorralonPedidosRanking.sync({ranking_version:35});assert.equal(requests.length,2);
 }finally{dom.window.close()}
});
