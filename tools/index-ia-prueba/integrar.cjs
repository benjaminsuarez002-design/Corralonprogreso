const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),target=path.join(root,'index.html');
let html=fs.readFileSync(target,'utf8');
const bridge=`
// Puente exclusivo del asistente de esta copia. Conserva los servicios originales.
let iaViewFilter=null;
if(typeof abrirPresupuestoCeramico==='function'){
 const originalBudget=abrirPresupuestoCeramico;
 abrirPresupuestoCeramico=function(...args){
   document.getElementById('cpIaBudgetNav')?.remove();document.getElementById('cpIaBudgetPhotoWrap')?.remove();document.getElementById('cpIaBudgetPhoto')?.remove();
   document.getElementById('ceramicoBudgetModal')?.classList.remove('cp-ia-budget-mode');
   return originalBudget(...args);
 };
}
const iaViewKey=typeof indexViewStorageKey==='string'?indexViewStorageKey+':ia-results':'';
if(iaViewKey&&typeof procesarBusquedaArticulos==='function'){
 try{iaViewFilter=JSON.parse(sessionStorage.getItem(iaViewKey)||'null');}catch(_){}
 const originalSearch=procesarBusquedaArticulos;
 let restoreFocus=!!iaViewFilter;
 procesarBusquedaArticulos=function(rawInput){
   if(iaViewFilter&&String(rawInput)===iaViewFilter.query&&Array.isArray(iaViewFilter.codes)){
     const byCode=new Map(todosArticulos.map(article=>[obtenerIdArticulo(article),article]));
     const resultados=iaViewFilter.codes.map(code=>byCode.get(code)).filter(Boolean);
     if(resultados.length){
       if(restoreFocus){restoreFocus=false;if(document.activeElement===searchInput)searchInput.blur();ocultarAsistenteBusqueda();}
       return {parsed:parsearBusquedaAvanzada(rawInput),resultados,highlightTerms:[]};
     }
   }
   return originalSearch(rawInput);
 };
 searchInput.addEventListener('input',()=>{iaViewFilter=null;try{sessionStorage.removeItem(iaViewKey);}catch(_){}},{capture:true});
}
window.CorralonIaCatalog={
 budget:({articles,area,glue=null,grout=null})=>{
   if(!articles.length)return;
   const merged=new Map([...todosArticulos,...articles,glue,grout].filter(Boolean).map(article=>[obtenerIdArticulo(article),article]));
   todosArticulos=prepararArticulosParaVista([...merged.values()]);
   let index=0,meters=String(area),includeGlue=!!glue,includeGrout=!!grout,selectedGlue=glue,selectedGrout=grout;
   function show(next,preserve=false){
     if(preserve){
       meters=document.getElementById('ceramicoBudgetMeters').value;
       includeGlue=document.getElementById('ceramicoBudgetIncludeGlue').checked;
       includeGrout=document.getElementById('ceramicoBudgetIncludeGrout').checked;
       selectedGlue=ceramicoBudgetGlueArticulo;selectedGrout=ceramicoBudgetGroutArticulo;
     }
     index=next;
     document.getElementById('cpIaBudgetNav')?.remove();
     const metersInput=document.getElementById('ceramicoBudgetMeters'),wasDisabled=metersInput.disabled;
     metersInput.disabled=true;
     abrirPresupuestoCeramico(obtenerIdArticulo(articles[index]));
     requestAnimationFrame(()=>{metersInput.disabled=wasDisabled;});
     document.getElementById('ceramicoBudgetModal').classList.add('cp-ia-budget-mode');
     const article=articles[index],photo=[article.fotoUrl,...(Array.isArray(article.imagenes)?article.imagenes:[])].find(url=>typeof url==='string'&&(url.startsWith('https://')||url.startsWith('http://')));
     if(photo){
       const button=document.createElement('button');button.id='cpIaBudgetPhotoWrap';button.type='button';button.setAttribute('aria-label','Ver foto de '+article.nombre);
       const image=document.createElement('img');image.id='cpIaBudgetPhoto';image.src=photo;image.alt=article.nombre;image.onerror=()=>button.remove();
       const hint=document.createElement('span');hint.textContent='Tocá para ver';button.append(image,hint);button.onclick=()=>abrirPopupImagen(photo,article.nombre);
       document.querySelector('#ceramicoBudgetModal .ceramico-budget-head>div').prepend(button);
     }
     document.getElementById('ceramicoBudgetMeters').value=meters;
     ceramicoBudgetGlueArticulo=selectedGlue;ceramicoBudgetGroutArticulo=selectedGrout;
     document.getElementById('ceramicoBudgetIncludeGlue').checked=includeGlue;
     document.getElementById('ceramicoBudgetIncludeGrout').checked=includeGrout;
     calcularPresupuestoCeramico();
     const nav=document.createElement('div');nav.id='cpIaBudgetNav';nav.setAttribute('aria-label','Modelos encontrados');
     const previous=document.createElement('button'),label=document.createElement('strong'),nextButton=document.createElement('button');
     previous.type=nextButton.type='button';previous.className=nextButton.className='product-detail-btn-secondary';
     previous.textContent='‹';nextButton.textContent='›';previous.setAttribute('aria-label','Modelo anterior');nextButton.setAttribute('aria-label','Modelo siguiente');
     previous.disabled=index===0;nextButton.disabled=index===articles.length-1;label.textContent=(index+1)+' de '+articles.length;label.setAttribute('aria-live','polite');
     previous.onclick=()=>show(index-1,true);nextButton.onclick=()=>show(index+1,true);nav.append(previous,label,nextButton);
     document.querySelector('#ceramicoBudgetModal .ceramico-budget-head').after(nav);
   }
   show(0);
 },
 accessories:async kind=>{
   if(kind==='pastina')return prepararArticulosParaVista(await consultarCatalogoPublicoReducido({codigos:['000353'],limite:1}));
   return cargarPegamentosPresupuesto();
 },
 materialQuantity:area=>Number(area)>0?Math.max(1,Math.round(Number(area)/3.5)):0,
 salesCache:new Map(),
 rank:async articles=>{
   const cache=window.CorralonIaCatalog.salesCache,now=Date.now();
   const codes=[...new Set(articles.map(obtenerIdArticulo))];
   try{
     const pending=codes.filter(code=>!cache.has(code)||now-cache.get(code).at>60000);
     for(let offset=0;offset<pending.length;offset+=80){
       const batch=pending.slice(offset,offset+80);
       const url=new URL(SUPABASE_URL+'/rest/v1/ranking_articulos_4m');
       url.searchParams.set('select','idart,ventas_progreso,ventas_calle5,unidades_progreso,unidades_calle5');
       url.searchParams.set('idart','in.('+batch.join(',')+')');
       const response=await fetch(url,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+SUPABASE_ANON_KEY}});
       if(!response.ok)throw Error('No se pudo consultar el ranking');
       const rows=await response.json(),metrics=new Map(rows.map(row=>[String(row.idart),{sales:Number(row.ventas_progreso||0)+Number(row.ventas_calle5||0),units:Number(row.unidades_progreso||0)+Number(row.unidades_calle5||0),at:now}]));
       batch.forEach(code=>cache.set(code,metrics.get(code)||{sales:0,units:0,at:now}));
     }
     return [...articles].sort((a,b)=>{const x=cache.get(obtenerIdArticulo(a)),y=cache.get(obtenerIdArticulo(b));return (y?.sales||0)-(x?.sales||0)||(y?.units||0)-(x?.units||0);});
   }catch{return articles;}
 },
 open:article=>{
   const code=obtenerIdArticulo(article);
   if(!todosArticulos.some(item=>obtenerIdArticulo(item)===code))todosArticulos=[...todosArticulos,...prepararArticulosParaVista([article])];
   abrirDetalleProducto(code);
 },
 hours:async()=>{
   const snapshot=await getDocFromServer(doc(db,'configuracion','horarios'));
   const data=snapshot.exists()?snapshot.data():{};
   return {sucursales:{progreso_ruta:String(data.sucursales?.progreso_ruta||'').trim(),calle5_espana:String(data.sucursales?.calle5_espana||'').trim()},retiros:String(data.retiros||'').trim()};
 },
 ceramics:async()=>{
   const result=[];
   for(let offset=0;offset<20000;offset+=250){const page=await indexFetchCategory('ceramico',offset);result.push(...page);if(!page.hasMore)return prepararArticulosParaVista(result);}
   throw Error('No se pudo completar la lista de cerámicos.');
 },
 search:async term=>{
   const parsed=parsearBusquedaAvanzada(term);
   const terms=[...parsed.termCounts.keys()];
   const queries=[...new Set([term,...terms.filter(token=>/[a-z]/i.test(token)&&token.length>=3).slice(0,4)])];
   const pages=await Promise.all(queries.map(termino=>consultarCatalogoPublicoReducido({termino,limite:600})));
   const merged=new Map([...todosArticulos,...pages.flat()].map(article=>[obtenerIdArticulo(article),article]));
   return prepararArticulosParaVista([...merged.values()]).map(article=>{
     const numeric=terms.filter(token=>/^[0-9]+$/.test(token));
     const tokens=['principal','secondary','hiddenTags'].flatMap(field=>article._searchTokens?.[field]||[]);
     if(!numeric.every(token=>tokens.includes(token)||String(obtenerIdArticulo(article))===token))return null;
     const meta=evaluarArticuloBusqueda(article,parsed);
     return meta?{article,meta}:null;
   }).filter(Boolean).sort((a,b)=>a.meta.firstWordPriority-b.meta.firstWordPriority||a.meta.score-b.meta.score).map(item=>item.article);
 },
 showSimilar:(articles,term='')=>{
   indexExitRubrosView();indexCategoryActive='';indexFavoritesActive=false;rubroActivo='';chipActivo='';sortActivo='';searchInput.value=String(term||'');terminoBaseBusquedaPublica='';
   iaViewFilter={query:searchInput.value,codes:articles.map(obtenerIdArticulo)};
   try{sessionStorage.setItem(iaViewKey,JSON.stringify(iaViewFilter));}catch(_){}
   if(document.activeElement===searchInput)searchInput.blur();ocultarAsistenteBusqueda();
   const merged=new Map([...todosArticulos,...articles].map(article=>[obtenerIdArticulo(article),article]));todosArticulos=[...merged.values()];actualizarChipsEtiqueta();renderProductos(prepararArticulosParaVista(articles));scrollMainToTop();
 }
};
`;
const start='// INICIO ASISTENTE IA COPIA',end='// FIN ASISTENTE IA COPIA';
if(html.includes(start)){const first=html.lastIndexOf('<script',html.indexOf(start)),last=html.indexOf('</script>',html.indexOf(end))+9;html=html.slice(0,first)+html.slice(last);}
if(html.includes('window.CorralonIaCatalog={')){
 html=html.replace(/\n\/\/ Puente exclusivo del asistente de esta copia[\s\S]*?\n};\n/,()=>bridge);
}else{
 const marker='cargarCarrito();\r\n</script>';
 if(!html.includes(marker))throw Error('No se encontro punto de integracion del catalogo');
 html=html.replace(marker,'cargarCarrito();\r\n'+bridge+'\r\n</script>');
}
const panel=fs.readFileSync(path.join(__dirname,'panel.js'),'utf8');
html=html.replace('</body>',`<script>\n${start}\n${panel}\n${end}\n</script>\n</body>`);
fs.writeFileSync(target,html);
console.log('Integrado en index.html oficial.');
