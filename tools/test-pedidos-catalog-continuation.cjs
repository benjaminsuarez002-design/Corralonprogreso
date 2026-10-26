const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','pedidos.html'),'utf8');
const systemSource=fs.readFileSync(require('node:path').join(__dirname,'..','corralon-system.js'),'utf8');
function take(name){const start=source.indexOf(`function ${name}(`);assert(start>=0,name);const end=source.indexOf('\nfunction ',start+10);return source.slice(start,end<0?source.length:end)}
const Catalog={catalogMatches(row,filter){const exact=filter.code&&(row.codProvNorm===filter.code||row.idartNorm===filter.code);if(exact)return true;return(!filter.code||row.codProvNorm.includes(filter.code)||row.idartNorm.includes(filter.code))&&(!(filter.articleWords||[]).length||filter.articleWords.every(word=>row.descripcionNorm.includes(word)))}};
const pagerStart=systemSource.indexOf('const ARTICLE_OPTION_PAGER = (() => {');
const pagerEnd=systemSource.indexOf('\n  const WEB_VERSION_NOTIFIER',pagerStart);
assert(pagerStart>=0&&pagerEnd>pagerStart,'shared article pager');
const articleOptionPager=vm.runInNewContext(`(()=>{${systemSource.slice(pagerStart,pagerEnd)};return ARTICLE_OPTION_PAGER})()`);
const context=vm.createContext({Catalog,CorralonSystem:{articleOptionPager}});
vm.runInContext(['articleRank','rankArticleOptions','articleOptionKey','completeArticleOptions','articleFilterHasSearch','takeArticleWindow','createArticleWindow'].map(take).join('\n')+'\nthis.complete=completeArticleOptions;this.createWindow=createArticleWindow;this.takeWindow=takeArticleWindow',context);
const row=(cod,desc)=>({codProv:cod,codProvNorm:cod.toLowerCase(),idart:'',idartNorm:'',descripcion:desc,descripcionNorm:desc.toLowerCase(),proveedor:'P'});
const catalog=[row('1','ALICATE'),row('2','DESTORNILLADOR'),row('3','LLAVE FRANCESA'),row('EXACTO','MARTILLO'),row('4','PINZA'),row('5','TORNILLO')];
let result=context.complete(catalog,{code:'',articleWords:['llave']},6);
assert.equal(JSON.stringify(result.map(item=>item.descripcion)),JSON.stringify(['LLAVE FRANCESA','MARTILLO','PINZA','TORNILLO','ALICATE','DESTORNILLADOR']));
result=context.complete(catalog,{code:'exacto',articleWords:['inexistente']},6);
assert.equal(result[0].codProv,'EXACTO');
assert.equal(new Set(result.map(item=>item.descripcion)).size,6);
result=context.complete(catalog,{code:'',articleWords:['sin-coincidencia']},3);
assert.equal(JSON.stringify(result.map(item=>item.descripcion)),JSON.stringify(['ALICATE','DESTORNILLADOR','LLAVE FRANCESA']));
const large=Array.from({length:200},(_,index)=>row(String(index),`ARTICULO ${String(index).padStart(3,'0')}`));
const page=context.createWindow(large,{code:'',articleWords:['articulo','100']});
assert.equal(page.focusIndex,20);
assert.equal(page.options[page.focusIndex].descripcion,'ARTICULO 100');
assert.equal(page.options.length,61);
const below=context.takeWindow(page,'down',40);
const above=context.takeWindow(page,'up',20);
assert.equal(below.length,40);
assert.equal(above.length,20);
assert.equal(new Set([...page.options,...below,...above].map(item=>item.descripcion)).size,121);
const reachable=[...page.options,...below,...above];
for(let block=context.takeWindow(page,'down',40);block.length;block=context.takeWindow(page,'down',40))reachable.push(...block);
for(let block=context.takeWindow(page,'up',20);block.length;block=context.takeWindow(page,'up',20))reachable.push(...block);
assert.equal(new Set(reachable.map(item=>item.descripcion)).size,large.length,'todo el catálogo queda alcanzable sin duplicados');
const exactPage=context.createWindow(catalog,{code:'exacto',articleWords:['sin-coincidencia']});
assert.equal(exactPage.options[exactPage.focusIndex].codProv,'EXACTO');
const workerFunction=source.indexOf('function createProviderCatalogContinuationWorker()');
const workerStart=source.indexOf('const code=`',workerFunction)+'const code=`'.length;
const workerEnd=source.indexOf('`;\n  const worker=',workerStart);
assert(workerFunction>=0&&workerStart>workerFunction&&workerEnd>workerStart,'worker source');
const workerSource=source.slice(workerStart,workerEnd);
new vm.Script(workerSource,{filename:'pedidos-provider-worker.js'});
const workerMessages=[];
const workerContext=vm.createContext({postMessage:message=>workerMessages.push(message)});
vm.runInContext(workerSource,workerContext,{filename:'pedidos-provider-worker.js'});
workerContext.onmessage({data:{type:'hydrate',provider:'PROVEEDOR A',rows:[{idart:'1',codProv:'A-1',descripcion:'ARTICULO ACTUALIZADO',proveedor:'PROVEEDOR A',precioCosto:150}]}});
workerContext.onmessage({data:{type:'query',seq:7,provider:'PROVEEDOR A',filter:{code:'',articleWords:['actualizado']},key:'consulta-a'}});
assert.equal(workerMessages[0].type,'loaded');
assert.equal(workerMessages[0].hydrated,true,'la actualización en segundo plano hidrata el proceso en memoria');
assert.equal(workerMessages[1].rows[0].descripcion,'ARTICULO ACTUALIZADO');
const ensureWorker=take('ensureProviderCatalogWorker');
assert(ensureWorker.includes('providerCatalogSessions.get(provider)'),'los proveedores abiertos se recuperan desde memoria');
assert(!ensureWorker.includes('providerCatalogWorker?.terminate()'),'cambiar de pedido no destruye la lista anterior');
assert(source.includes('PROVIDER_CATALOG_SESSION_LIMIT=6'),'la memoria de listas tiene un límite');
for(const file of ['cargastock.html','faltantes.html','facturacion.html','historial.html']){
  const html=fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');
  assert(html.includes('articleOptionPager'),`${file} usa la paginación compartida`);
}
assert(!fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8').includes('articleOptionPager'),'index.html permanece excluido');
assert(!fs.readFileSync(require('node:path').join(__dirname,'..','remitos.html'),'utf8').includes('articleOptionPager'),'remitos permanece con descripciones libres');
const functionsGuide=fs.readFileSync(require('node:path').join(__dirname,'..','aplica funciones.txt'),'utf8');
assert(functionsGuide.includes('20 articulos anteriores')&&functionsGuide.includes('40 posteriores'),'aplica funciones documenta la ventana del catálogo');
console.log('Pedidos: coincidencias primero, código exacto prioritario y continuación A-Z verificados.');

// A pending search must keep the previous results visible, but not selectable.
let menuWrites=0,menuHtml='existing-results';
const menu={get innerHTML(){return menuHtml},set innerHTML(value){menuWrites++;menuHtml=value}};
const previous=[row('3','LLAVE FRANCESA')];
const searchContext=vm.createContext({
  combo:{options:previous,loading:false,mode:'article',rowIndex:0,active:0},
  els:{comboMenu:menu,filterPriceList:{checked:true}},
  providerLastQuery:'P:llave',providerLastOptions:previous,providerLastFocusIndex:0,providerQuerySeq:1,
  providerCatalogProvider:'P',selectedProviderName:()=> 'P',
  articleFilter:()=>({}),providerQueryKey:(provider,text)=>provider+':'+text,
  requestProviderArticleOptions:()=>{},esc:String,money:String
});
vm.runInContext(['articleOptionsWithContinuation','renderComboOptions','pickCombo','requestComboPage'].map(take).join('\n'),searchContext);
searchContext.nextText='llave f';
vm.runInContext('combo.options=articleOptionsWithContinuation(nextText,0);renderComboOptions();pickCombo();requestComboPage("down")',searchContext);
assert.equal(menuWrites,0,'typing must not replace results with a loading row');
assert.equal(menuHtml,'existing-results');
assert.equal(searchContext.combo.options,previous);
assert.equal(searchContext.combo.loading,true);
// Backspacing to the cached query invalidates an outstanding newer query.
const seq=searchContext.providerQuerySeq;
vm.runInContext('combo.options=articleOptionsWithContinuation("llave",0)',searchContext);
assert.equal(searchContext.combo.loading,false);
assert(searchContext.providerQuerySeq>seq,'late search replies must be ignored after returning to cached text');
searchContext.combo.options=[row('4','LLAVE NUEVA')];
vm.runInContext('renderComboOptions()',searchContext);
assert.equal(menuWrites,1,'completed search replaces results in one update');
assert(menuHtml.includes('LLAVE NUEVA'));
searchContext.combo.options=[];searchContext.combo.loading=true;
vm.runInContext('renderComboOptions()',searchContext);
assert(menuHtml.includes('Cargando...'),'initial load still has feedback');
console.log('Pedidos: resultados estables al escribir, selección bloqueada durante búsqueda y regreso a consulta en caché verificados.');
