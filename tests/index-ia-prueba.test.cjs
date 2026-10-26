const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{JSDOM,VirtualConsole}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const root=path.resolve(__dirname,'..'),panel=fs.readFileSync(path.join(root,'tools/index-ia-prueba/panel.js'),'utf8');
const wait=()=>new Promise(resolve=>setTimeout(resolve,10));
function setup(name='index copia ia.html'){
 const dom=new JSDOM('<body><input id="mainSearch"></body>',{url:'http://localhost:8080/'+encodeURIComponent(name),runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
 const articles=[{codigo:'001',nombre:'CERAMICO PRIMERA 36X36',ceramico:true,ceramicoM2:2.68,precio:32000,imagenes:[]},{codigo:'002',nombre:'CERAMICO SEGUNDA 43X43',ceramico:true,ceramicoM2:2.25,precio:18000},{codigo:'003',nombre:'CERAMICO PRIMERA 51X51',ceramico:true,ceramicoM2:2.08,precio:26000},{codigo:'004',nombre:'CERAMICO SEGUNDA 36X36',ceramico:true,ceramicoM2:2.68,precio:20000},{codigo:'005',nombre:'CERAMICO PRIMERA 43X43',ceramico:true,ceramicoM2:2.25,precio:26000}];
 let similar=null,calls=0;
 w.CorralonIaCatalog={hours:async()=>({sucursales:{},retiros:''}),ceramics:async()=>articles,search:async()=>articles,showSimilar:rows=>similar=rows};w.AbortSignal.timeout=AbortSignal.timeout;
 w.fetch=async()=>{calls++;return Response.json({intent:{kind:'ceramicos',area:50,quality:'',size:''}})};
 w.eval(panel);return{dom,w,articles,similar:()=>similar,calls:()=>calls};
}
test('cajas completas y total se calculan con precio vigente; ignora piezas sin rendimiento',()=>{const s=setup();try{const quote=s.w.CorralonIaMath.quote({...s.articles[0],precioVigente:30000},50);assert.equal(quote.boxes,19);assert.equal(quote.total,570000);assert.ok(Math.abs(quote.coverage-50.92)<1e-8);assert.equal(s.w.CorralonIaMath.quote({...s.articles[0],ceramicoM2:0},50),null);assert.equal(s.w.CorralonIaMath.quote(s.articles[0],2.68).boxes,1);}finally{s.dom.window.close()}});
test('muestra dos opciones y abre todas las coincidencias en el catalogo',async()=>{const s=setup('index.html');try{s.w.CorralonIaCatalog.rank=async rows=>[...rows].reverse();const d=s.w.document;d.getElementById('cpIaLaunch').click();d.getElementById('cpIaInput').value='50 m2 de cerámico';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();assert.equal(d.querySelectorAll('.cp-ia-card').length,2);assert.ok(d.querySelector('.cp-ia-card').textContent.includes('cajas'));assert.equal(new URL(d.querySelector('.cp-ia-card .cp-ia-link').href).searchParams.get('articulo'),'005');for(const link of d.querySelectorAll('.cp-ia-link')){const url=new URL(link.href);assert.equal(url.pathname,'/index.html');assert.ok(url.searchParams.has('articulo'));}d.querySelector('.cp-ia-more').click();assert.ok(s.similar().length>=4);assert.equal(d.getElementById('cpIaPanel').hidden,true);assert.equal(d.querySelectorAll('.cp-ia-card').length,2);}finally{s.dom.window.close()}});
test('horarios interpretados no inventan horas',async()=>{const s=setup();try{const d=s.w.document;d.getElementById('cpIaInput').value='Horarios y retiro';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();assert.equal(s.calls(),0);assert.match(d.getElementById('cpIaLog').textContent,/Todavía no hay horarios cargados/);assert.ok(d.querySelector('a[href="https://wa.me/542645802404"]'));}finally{s.dom.window.close()}});
test('Index oficial tiene un solo asistente Obri',()=>{const official=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.equal((official.match(/\/\/ INICIO ASISTENTE IA COPIA/g)||[]).length,1);assert.match(official,/<strong>Obri<\/strong>/);});
test('sintaxis de todos los scripts inline de la copia',()=>{const{spawnSync}=require('node:child_process'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc\s*=/.test(match[1]))continue;const result=spawnSync(process.execPath,['--check','--input-type='+(/type="module"/.test(match[1])?'module':'commonjs')],{input:match[2],encoding:'utf8'});assert.equal(result.status,0,result.stderr);}});
test('normaliza interpretacion sin inventar calidad y rechaza origen desconocido antes de usar IA',async()=>{const mod=await import('../tools/index-ia-prueba/worker.mjs');const intent=mod.cleanIntent({kind:'ceramico',quality:'primera',area:50,size:'36x36'},'50 metros de cerámico');assert.equal(intent.kind,'ceramicos');assert.equal(intent.quality,'');assert.equal(intent.size,'');assert.equal(mod.cleanIntent({kind:'ceramicos'},'pegamento para porcelanato').kind,'productos');let called=false;const response=await mod.default.fetch(new Request('https://test/interpretar',{method:'POST',headers:{origin:'https://unknown.example'},body:'{}'}),{AI:{run:()=>called=true}});assert.equal(response.status,403);assert.equal(called,false);});

test('entiende preguntas de precio coloquiales aunque el modelo las clasifique fuera',async()=>{const{cleanIntent}=await import('../tools/index-ia-prueba/worker.mjs');for(const[message,query]of [['a cuanto el fierro del 6','hierro 6'],['a cuanto una wincha?','cinta metrica'],['que sale la membrana?','membrana']]){const intent=cleanIntent({kind:'fuera'},message);assert.equal(intent.kind,'productos');assert.equal(intent.query,query);}assert.equal(cleanIntent({kind:'fuera',query:'Napoleon'},'quien fue Napoleon').kind,'fuera');});

test('puente busca tags por palabra, conserva medida exacta y no modifica el catalogo visible',async()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const bridge=html.match(/\/\/ Puente exclusivo del asistente de esta copia[\s\S]*?\n};/)[0];
 const original=[{codigo:'visible'}],queries=[];
 const rows=[{codigo:'000005',nombre:'HIERRO 6 MM',tags:'fierro obra del 6 yerro varilla'},{codigo:'000008',nombre:'HIERRO 8 MM',tags:'varilla'},{codigo:'000016',nombre:'HIERRO 16 MM',tags:'varilla'}];
 const context={window:{},todosArticulos:original,parsearBusquedaAvanzada:term=>({termCounts:new Map(term.split(' ').map(word=>[word,1]))}),
  consultarCatalogoPublicoReducido:async({termino,limite})=>{queries.push(termino);assert.equal(limite,600);return termino==='varilla'?rows:[];},
  obtenerIdArticulo:a=>a.codigo,
  prepararArticulosParaVista:items=>items.map(a=>({...a,_searchTokens:{principal:(a.nombre||'').toLowerCase().split(' '),hiddenTags:(a.tags||'').split(' ')}})),
  evaluarArticuloBusqueda:(a,parsed)=>[...parsed.termCounts.keys()].every(t=>[...a._searchTokens.principal,...a._searchTokens.hiddenTags].includes(t))?{score:0,firstWordPriority:0}:null};
 vm.runInNewContext(bridge,context);
 const results=await context.window.CorralonIaCatalog.search('varilla 6');
 assert.deepEqual(Array.from(results,a=>a.codigo),['000005']);assert.deepEqual(queries,['varilla 6','varilla']);assert.equal(context.todosArticulos,original);assert.equal(original.length,1);
});

test('si falla el nombre inicial intenta alternativas y conserva la posicion del chat',async()=>{
 const s=setup();try{
  const queries=[],d=s.w.document,log=d.getElementById('cpIaLog');log.scrollTop=25;
  s.w.fetch=async()=>Response.json({intent:{kind:'productos',query:'huincha larga',alternatives:['cinta metrica','flexometro']}});
  s.w.CorralonIaCatalog.search=async term=>{queries.push(term);return term==='cinta metrica'?[{codigo:'123',nombre:'CINTA METRICA 5 M',precio:5000}]:[]};
  d.getElementById('cpIaInput').value='busco una huincha larga';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();
  assert.deepEqual(queries,['huincha larga','cinta metrica','flexometro']);assert.match(log.textContent,/CINTA METRICA 5 M/);assert.equal(log.scrollTop,25);assert.doesNotMatch(log.textContent,/Buscando opciones|Buscando con otros/);
 }finally{s.dom.window.close()}
});

test('alternativas de IA no pueden cambiar la medida solicitada',async()=>{
 const{cleanIntent}=await import('../tools/index-ia-prueba/worker.mjs');
 const result=cleanIntent({kind:'productos',query:'varilla 6',alternatives:['hierro 6','hierro 8','hierro','hierro 6',null]},'a cuanto la varilla del 6');
 assert.deepEqual(result.alternatives,['hierro 6']);
});

test('recuerda aclaraciones sin enviar el indicador de carga y busca por el producto principal',async()=>{
 const s=setup();try{
  const d=s.w.document,requests=[];let turn=0;
  s.w.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json({intent:++turn===1?{kind:'aclaracion',reply:'La madera no se suelda con electrodos. ¿Te referías a chapa?'}:{kind:'productos',query:'electrodo soldar chapa',alternatives:[]}})};
  s.w.CorralonIaCatalog.search=async term=>term==='electrodo'?[{codigo:'007',nombre:'ELECTRODO 2.5 MM',precio:1000}]:[];
  async function send(text){d.getElementById('cpIaInput').value=text;d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait()}
  await send('electrodo para soldar madera tenes');await send('para chapa comun');
  assert.equal(requests[1].history[0].content,'electrodo para soldar madera tenes');assert.match(requests[1].history[1].content,/madera no se suelda/);assert.ok(requests[1].history.every(turn=>!turn.content.includes('Buscando opciones')));assert.match(d.getElementById('cpIaLog').textContent,/opciones relacionadas/);assert.match(d.getElementById('cpIaLog').textContent,/ELECTRODO 2.5 MM/);
 }finally{s.dom.window.close()}
});

test('pedir para llamar o un numero muestra contacto en vez de productos o ubicacion',async()=>{
 for(const message of ['tenes para llamar?','donde puedo llamar? un numero de telefono?','un numero?']){
  const s=setup();try{s.w.fetch=async()=>Response.json({intent:{kind:'contacto'}});const d=s.w.document;d.getElementById('cpIaInput').value=message;d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();assert.match(d.getElementById('cpIaLog').textContent,/2645 80-2404/);assert.ok(d.querySelector('a[href="tel:+542645802404"]'));assert.equal(s.calls(),0);assert.doesNotMatch(d.getElementById('cpIaLog').textContent,/Te dejo cómo llegar|coincidencia segura/);}finally{s.dom.window.close()}
 }
});

test('modelo nuevo conserva intencion semantica de contacto aunque diga tenes',async()=>{
 const{cleanIntent,MODEL}=await import('../tools/index-ia-prueba/worker.mjs');
 assert.match(MODEL,/llama-3\.3-70b/);assert.equal(cleanIntent({kind:'contacto'},'tenes para llamar?').kind,'contacto');
 assert.equal(cleanIntent({kind:'productos',query:'cable telefono'},'tenes cable para telefono?').kind,'productos');
});

test('respuesta conversacional recibe solo los articulos publicos y se conserva el precio calculado',async()=>{
 const s=setup();try{
  let context;const d=s.w.document;
  s.w.CorralonIaCatalog.search=async()=>[{codigo:'006',nombre:'CINTA METRICA',detalle:'Cinta de 5 metros',precio:1234,costo:999}];
  s.w.fetch=async(url,options)=>url.endsWith('/responder')?(context=JSON.parse(options.body),Response.json({reply:'Encontré esta cinta. Podés abrir la ficha para ver sus detalles.'})):Response.json({intent:{kind:'productos',query:'cinta'}});
  d.getElementById('cpIaInput').value='busco una cinta';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();
  assert.equal(context.articles[0].detalle,'Cinta de 5 metros');assert.equal(context.articles[0].costo,undefined);assert.equal(context.articles[0].precio,undefined);assert.match(d.getElementById('cpIaLog').textContent,/Encontré esta cinta/);assert.match(d.getElementById('cpIaLog').textContent,/1\.234,00/);
 }finally{s.dom.window.close()}
});

test('horarios lee lo guardado por sucursal y vuelve a consultar despues de una edicion',async()=>{
 const s=setup();try{
  const d=s.w.document;let calls=0,hours='Lunes a viernes de 8 a 18';
  s.w.CorralonIaCatalog.hours=async()=>{calls++;return{sucursales:{progreso_ruta:hours,calle5_espana:'Sábados de 8 a 13'},retiros:'Retirar hasta las 17'}};
  async function ask(){d.getElementById('cpIaInput').value='Horarios y retiro';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait()}
  await ask();assert.match(d.getElementById('cpIaLog').textContent,/Progreso y Ruta:\nLunes a viernes de 8 a 18/);assert.match(d.getElementById('cpIaLog').textContent,/Calle 5 y España:\nSábados de 8 a 13/);assert.match(d.getElementById('cpIaLog').textContent,/Retirar hasta las 17/);
  hours='Cerrado el lunes';await ask();assert.equal(calls,2);assert.match(d.getElementById('cpIaLog').textContent,/Cerrado el lunes/);
 }finally{s.dom.window.close()}
});

test('enlaces de producto y ceramico cierran el asistente antes de abrir el detalle en la misma pagina',async()=>{
 for(const kind of ['productos','ceramicos']){
  const s=setup();try{const d=s.w.document;let opened;
   s.w.fetch=async url=>url.endsWith('/responder')?Response.json({reply:''}):Response.json({intent:{kind,query:'ceramico',area:50}});
   s.w.CorralonIaCatalog.open=article=>{assert.equal(d.getElementById('cpIaPanel').hidden,true);opened=article};
   d.getElementById('cpIaLaunch').click();d.getElementById('cpIaInput').value='mostrame opciones';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();
   const anchor=d.querySelector('.cp-ia-card .cp-ia-link');assert.ok(anchor);assert.notEqual(anchor.target,'_blank');const expected=new URL(anchor.href).searchParams.get('articulo');anchor.click();assert.equal(opened.codigo,expected);assert.equal(s.w.location.pathname,'/index%20copia%20ia.html');
  }finally{s.dom.window.close()}
 }
});

test('ranking real suma sucursales, desempata por unidades y reutiliza la consulta',async()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),bridge=html.match(/\/\/ Puente exclusivo del asistente de esta copia[\s\S]*?\n};/)[0];let calls=0;
 const context={window:{},URL,SUPABASE_URL:'https://test.example',SUPABASE_ANON_KEY:'public',obtenerIdArticulo:a=>a.codigo,fetch:async url=>{calls++;assert.match(String(url),/ranking_articulos_4m/);return Response.json([{idart:'001',ventas_progreso:10,ventas_calle5:5,unidades_progreso:300,unidades_calle5:100},{idart:'002',ventas_progreso:400,ventas_calle5:100,unidades_progreso:600,unidades_calle5:400},{idart:'003',ventas_progreso:300,ventas_calle5:200,unidades_progreso:800,unidades_calle5:500}])}};
 vm.runInNewContext(bridge,context);const input=[{codigo:'001'},{codigo:'002'},{codigo:'003'}],rank=context.window.CorralonIaCatalog.rank;
 assert.deepEqual(Array.from(await rank(input),a=>a.codigo),['003','002','001']);await rank(input);assert.equal(calls,1);assert.equal(input[0].codigo,'001');
});

test('al enviar alinea la pregunta arriba y no sigue desplazando al llegar la respuesta',async()=>{
 const s=setup();try{
  const d=s.w.document,log=d.getElementById('cpIaLog');let resolve;
  Object.defineProperty(log,'clientHeight',{value:300});log.scrollTop=25;
  const original=s.w.HTMLElement.prototype.getBoundingClientRect;
  s.w.HTMLElement.prototype.getBoundingClientRect=function(){return this===log?{top:100}:this.classList.contains('cp-ia-turn')?{top:300}:original.call(this)};
  s.w.fetch=()=>new Promise(done=>resolve=done);
  d.getElementById('cpIaInput').value='cuanto sale el pegamento';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));
  assert.equal(log.scrollTop,211);const group=log.querySelector('.cp-ia-turn');assert.ok(group.firstElementChild.classList.contains('cp-ia-user'));assert.equal(group.style.minHeight,'272px');
  log.scrollTop=180;resolve(Response.json({intent:{kind:'charla',reply:'Una respuesta larga. '.repeat(80)}}));await wait();assert.equal(log.scrollTop,180);
 }finally{s.dom.window.close()}
});

test('30 m2 conserva superficie para pegamento y pastina; similares no expande el chat al reabrir',async()=>{
 const s=setup();try{
  const d=s.w.document,kinds=[];let shown;
  s.w.fetch=async()=>Response.json({intent:{kind:'ceramicos',area:30}});
  s.w.CorralonIaCatalog.accessories=async kind=>{kinds.push(kind);return kind==='pegamento'?[{codigo:'p1',nombre:'PEGAMENTO OPTIMO 25KG',precio:10000},{codigo:'p2',nombre:'PEGAMENTO PERFECTO 25 KG',precio:12000},{codigo:'p3',nombre:'PEGAMENTO MAPEI 25KG',precio:15000},{codigo:'p4',nombre:'PEGAMENTO SUELTO X KG',precio:800}]:[{codigo:'000353',nombre:'PASTINA 1KG',precio:2000}]};
  s.w.CorralonIaCatalog.materialQuantity=area=>Math.max(1,Math.round(area/3.5));
  s.w.CorralonIaCatalog.showSimilar=(articles,term)=>shown={articles,term};
  async function send(text){d.getElementById('cpIaInput').value=text;d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait()}
  d.getElementById('cpIaLaunch').click();await send('30 metros de ceramico');await send('y con apegamento?');
  let turn=d.querySelector('.cp-ia-turn:last-child');assert.equal(turn.querySelectorAll('.cp-ia-card').length,2);assert.match(turn.textContent,/9 bolsas de 25 kg/);assert.match(turn.textContent,/90\.000,00/);
  turn.querySelector('.cp-ia-more').click();assert.equal(shown.articles.length,3);assert.equal(shown.term,'pegamento');assert.equal(d.getElementById('cpIaPanel').hidden,true);
  d.getElementById('cpIaLaunch').click();assert.equal(turn.querySelectorAll('.cp-ia-card').length,2);
  await send('y la pastina?');turn=d.querySelector('.cp-ia-turn:last-child');assert.match(turn.textContent,/30 m²/);assert.match(turn.textContent,/9 envases de pastina/);assert.match(turn.textContent,/18\.000,00/);assert.deepEqual(kinds,['pegamento','pastina']);
  await send('y con el pegamento y pastina?');turn=d.querySelector('.cp-ia-turn:last-child');
  assert.match(turn.textContent,/9 bolsas de 25 kg y 9 envases de pastina/);assert.equal(turn.querySelectorAll('.cp-ia-card').length,2);
  assert.equal(turn.querySelectorAll('.cp-ia-combined-total').length,2);assert.match(turn.querySelector('.cp-ia-combined-total').textContent,/108\.000,00/);
  assert.deepEqual(kinds,['pegamento','pastina','pegamento','pastina']);assert.ok(turn.querySelector('a[href*="000353"]'));

 }finally{s.dom.window.close()}
});

test('modelo especifico, abreviaturas de metros y adicionales en el mismo presupuesto',async()=>{
 for(const unit of ['m','mt','mts','m2','m²','metros','metros cuadrados']){
  const s=setup();try{
   const d=s.w.document,padua={codigo:'padua1',nombre:'CERAMICO ALLPA 1RA PADUA GRIS 34X51',ceramico:true,ceramicoM2:2.27,precio:30000};
   s.w.CorralonIaCatalog.ceramics=async()=>[...s.articles,padua,{...padua,codigo:'padua2',nombre:'CERAMICO ALLPA 2DA PADUA GRIS 34X51'}];
   s.w.CorralonIaCatalog.search=async term=>{assert.equal(term,'padua gris');return[padua,{...padua,codigo:'padua2'}]};
   s.w.CorralonIaCatalog.accessories=async kind=>kind==='pegamento'?[{codigo:'g1',nombre:'PEGAMENTO OPTIMO 25KG',precio:10000},{codigo:'g2',nombre:'PEGAMENTO PERFECTO 25KG',precio:11000}]:[{codigo:'000353',nombre:'PASTINA CERAMICO X 1KG',precio:2000}];
   s.w.CorralonIaCatalog.materialQuantity=area=>Math.max(1,Math.round(area/3.5));
   s.w.fetch=async()=>Response.json({intent:{kind:'ceramicos',area:null,quality:'primera'}});
   d.getElementById('cpIaInput').value='cuanto son 50 '+unit+' de padua gris de 1ra con pegamento y pastona?';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();
   const cards=[...d.querySelectorAll('.cp-ia-card')];assert.equal(cards.length,2,unit);assert.ok(cards.every(card=>card.textContent.includes('1RA PADUA GRIS')));assert.match(cards[0].textContent,/23 cajas/);assert.match(cards[0].textContent,/15 × PEGAMENTO OPTIMO/);assert.match(cards[0].textContent,/15 × PASTINA/);assert.match(cards[0].textContent,/Total con adicionales:.*870\.000,00/);
  }finally{s.dom.window.close()}
 }
});

test('la vista IA conserva coincidencias y orden al recargar y libera el filtro al escribir',()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),bridge=html.match(/\/\/ Puente exclusivo del asistente de esta copia[\s\S]*?\n};/)[0],storage=new Map();
 function page(articles){let onInput,hidden=0;const search={value:'ceramico primera',addEventListener:(name,fn)=>{if(name==='input')onInput=fn},blur:()=>context.document.activeElement=null};
  const context={window:{},indexViewStorageKey:'copy-view',sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},procesarBusquedaArticulos:()=>({resultados:[]}),parsearBusquedaAvanzada:()=>({hasText:true}),todosArticulos:articles,obtenerIdArticulo:a=>a.codigo,searchInput:search,document:{activeElement:search},ocultarAsistenteBusqueda:()=>hidden++,indexExitRubrosView:()=>{},actualizarChipsEtiqueta:()=>{},prepararArticulosParaVista:rows=>rows,renderProductos:()=>{},scrollMainToTop:()=>{}};
  vm.runInNewContext(bridge,context);return{context,search,input:()=>onInput(),hidden:()=>hidden};
 }
 const rows=[{codigo:'b',nombre:'CERAMICO 1RA B'},{codigo:'a',nombre:'CERAMICO 1RA A'}],first=page([]);
 first.context.window.CorralonIaCatalog.showSimilar(rows,'ceramico primera');
 const reload=page(first.context.todosArticulos),results=reload.context.procesarBusquedaArticulos('ceramico primera').resultados;
 assert.deepEqual(Array.from(results,row=>row.codigo),['b','a']);assert.equal(reload.context.document.activeElement,null);assert.equal(reload.hidden(),1);
 reload.input();assert.equal(reload.context.procesarBusquedaArticulos('otra busqueda').resultados.length,0);assert.equal(storage.size,0);
});

test('Acacia se reconoce antes o despues de los metros y el ranking no introduce otro modelo',async()=>{
 for(const message of ['tenes ceramico acacia? necesito 50 m con pegamento y pastina','necesito 50 mts de ceramico acacia con pegamento y pastina','tenes ceramico acacia?']){
  const s=setup();try{
   const d=s.w.document,acacia={codigo:'ac1',nombre:'CERAMICO ALLPA 1RA ACACIA 36X36',ceramico:true,ceramicoM2:2.68,precio:32000};
   s.w.CorralonIaCatalog.ceramics=async()=>[...s.articles,acacia,{...acacia,codigo:'ac2',nombre:'CERAMICO ALLPA 2DA ACACIA 36X36'}];
   s.w.CorralonIaCatalog.rank=async articles=>{if(articles.some(a=>a.ceramico))assert.ok(articles.every(a=>a.nombre.includes('ACACIA')));return articles};
   s.w.CorralonIaCatalog.accessories=async kind=>[{codigo:kind,nombre:kind==='pegamento'?'PEGAMENTO 25KG':'PASTINA 1KG',precio:1000}];
   s.w.CorralonIaCatalog.materialQuantity=area=>Math.round(area/3.5);
   s.w.fetch=async()=>Response.json({intent:{kind:'ceramicos',area:50,query:'ceramico'}});
   d.getElementById('cpIaInput').value=message;d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();
   const cards=[...d.querySelectorAll('.cp-ia-card')];assert.equal(cards.length,2,message);assert.ok(cards.every(card=>card.querySelector('h4').textContent.includes('ACACIA')),message);
   if(message.includes('pastina'))assert.ok(cards.every(card=>card.textContent.includes('Total con adicionales:')));
  }finally{s.dom.window.close()}
 }
});

test('presupuesto nativo precarga metros y adicionales y conserva cambios entre primera y segunda',()=>{
 const vm=require('node:vm'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),dom=new JSDOM(html,{url:'http://localhost:8080/index%20copia%20ia.html'}),d=dom.window.document;
 try{
  const bridge=html.match(/\/\/ Puente exclusivo del asistente de esta copia[\s\S]*?\n};/)[0],open=html.match(/function abrirPresupuestoCeramico\([\s\S]*?\n}/)[0];
  const articles=[{codigo:'ac1',nombre:'ACACIA 1RA',fotoUrl:'https://example.com/acacia1.jpg',ceramico:true,ceramicoM2:2.68},{codigo:'ac2',nombre:'ACACIA 2DA',fotoUrl:'https://example.com/acacia2.jpg',ceramico:true,ceramicoM2:2.68}],glue={codigo:'glue',nombre:'PEGAMENTO 25KG'},grout={codigo:'000353',nombre:'PASTINA'};
  const context={window:{},document:d,todosArticulos:[],obtenerIdArticulo:a=>a.codigo,prepararArticulosParaVista:rows=>rows,productDetailAdminCode:'',buscarArticuloPorCodigo:code=>context.todosArticulos.find(a=>a.codigo===code),buscarArticuloPorCodigoFlexible:()=>grout,esArticuloPegamento:()=>false,sanitizeM2:Number,obtenerDescripcionArticulo:a=>({principal:a.nombre}),fmtM2:String,actualizarSeleccionesCeramico:()=>{},actualizarIndicadorPrecioPresupuestoCeramico:()=>{},calcularPresupuestoCeramico:()=>{},requestAnimationFrame:fn=>fn()};
  vm.runInNewContext(open+'\n'+bridge,context);
  context.abrirPopupImagen=(src,alt)=>{context.zoom={src,alt}};
  context.window.CorralonIaCatalog.budget({articles,area:50,glue,grout});
  assert.match(d.getElementById('cpIaBudgetPhotoWrap').textContent,/Tocá para ver/);d.getElementById('cpIaBudgetPhotoWrap').click();assert.equal(context.zoom.src,articles[0].fotoUrl);
  assert.equal(d.getElementById('ceramicoBudgetMeters').value,'50');assert.equal(d.getElementById('ceramicoBudgetIncludeGlue').checked,true);assert.equal(d.getElementById('ceramicoBudgetIncludeGrout').checked,true);assert.equal(context.ceramicoBudgetGlueArticulo,glue);assert.equal(d.querySelector('#cpIaBudgetNav strong').textContent,'1 de 2');assert.ok(d.getElementById('ceramicoBudgetModal').classList.contains('visible'));assert.ok(d.getElementById('ceramicoBudgetModal').classList.contains('cp-ia-budget-mode'));assert.match(d.getElementById('cpIaBudgetPhoto').src,/acacia1.jpg/);
  d.getElementById('ceramicoBudgetMeters').value='65';d.getElementById('ceramicoBudgetIncludeGrout').checked=false;d.querySelector('#cpIaBudgetNav button:last-child').click();
  assert.equal(context.ceramicoBudgetArticulo.codigo,'ac2');assert.equal(d.getElementById('ceramicoBudgetMeters').value,'65');assert.equal(d.getElementById('ceramicoBudgetIncludeGrout').checked,false);assert.equal(d.querySelector('#cpIaBudgetNav strong').textContent,'2 de 2');assert.match(d.getElementById('cpIaBudgetPhoto').src,/acacia2.jpg/);
  context.abrirPresupuestoCeramico('ac1');assert.equal(d.getElementById('cpIaBudgetNav'),null);assert.equal(d.getElementById('cpIaBudgetPhoto'),null);assert.equal(d.getElementById('ceramicoBudgetModal').classList.contains('cp-ia-budget-mode'),false);
 }finally{dom.window.close()}
});

test('pedido con metros espera el clic en Ver presupuesto antes de cerrar chat y abrirlo',async()=>{
 const s=setup();try{
  const d=s.w.document;let config;
  s.w.CorralonIaCatalog.accessories=async kind=>[{codigo:kind,nombre:kind==='pegamento'?'PEGAMENTO 25KG':'PASTINA 1KG',precio:1000}];
  s.w.CorralonIaCatalog.budget=options=>{assert.equal(d.getElementById('cpIaPanel').hidden,true);config=options};
  d.getElementById('cpIaLaunch').click();d.getElementById('cpIaInput').value='50 m2 de ceramico con pegamento y pastina';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();
  assert.equal(config,undefined);assert.equal(d.getElementById('cpIaPanel').hidden,false);d.querySelector('.cp-ia-more').click();
  assert.equal(config.area,50);assert.equal(config.glue.codigo,'pegamento');assert.equal(config.grout.codigo,'pastina');assert.equal(config.articles.length,5);assert.equal(d.querySelectorAll('.cp-ia-card').length,0);assert.match(d.getElementById('cpIaLog').textContent,/Ver presupuesto/);
 }finally{s.dom.window.close()}
});

test('Calacata 30m sin palabra ceramico usa el catalogo y abre presupuesto completo sin clasificarlo fuera',async()=>{
 const s=setup();try{
  const d=s.w.document;let config;
  s.w.fetch=async()=>{throw Error('No debe depender de la clasificacion de IA para un modelo encontrado')};
  s.w.CorralonIaCatalog.search=async term=>{assert.equal(term,'calacata');return[{codigo:'c1',nombre:'CERAMICO ALLPA 1RA CALACATA',ceramico:true,ceramicoM2:2.27,precio:28000},{codigo:'c2',nombre:'CERAMICO ALLPA 2DA CALACATA',ceramico:true,ceramicoM2:2.27,precio:24000}]};
  s.w.CorralonIaCatalog.accessories=async kind=>[{codigo:kind,nombre:kind==='pegamento'?'PEGAMENTO 25KG':'PASTINA 1KG',precio:1000}];
  s.w.CorralonIaCatalog.budget=options=>config=options;
  d.getElementById('cpIaLaunch').click();d.getElementById('cpIaInput').value='tenes calacata 30m?, con pegamento y pastina';d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();
  assert.equal(config,undefined);d.querySelector('.cp-ia-more').click();assert.equal(config.area,30);assert.equal(config.articles.length,2);assert.ok(config.articles.every(a=>a.nombre.includes('CALACATA')));assert.equal(config.glue.codigo,'pegamento');assert.equal(config.grout.codigo,'pastina');assert.equal(d.getElementById('cpIaPanel').hidden,true);assert.doesNotMatch(d.getElementById('cpIaLog').textContent,/No logré ubicar/);
  for(const [expression,area]of [['2 x 3mt',6],['2 por 3 metros',6],['2m × 3m',6],['2,5 x 3 mts',7.5],['2.5 * 3 m2',7.5],['20 x 30 mt',600]]){
   config=undefined;d.getElementById('cpIaLaunch').click();d.getElementById('cpIaInput').value='necesito calacata '+expression;
   d.getElementById('cpIaForm').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await wait();
   d.querySelector('.cp-ia-turn:last-child .cp-ia-more').click();assert.equal(config.area,area,expression);assert.equal(config.articles.length,2);
  }

 }finally{s.dom.window.close()}
});
