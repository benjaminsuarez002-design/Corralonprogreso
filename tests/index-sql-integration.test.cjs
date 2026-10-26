const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
async function setup(logged=true){
 const dom=new JSDOM('<body></body>',{url:'https://corralonprogreso.com/index%20-%20copia',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,store=new Map(),calls=[];
 let user=logged?{id:'user-test',nombre:'Usuario prueba',nivel:'administrador'}:null;
 const network={firebaseAvailable:true};
 w.localStorage.setItem('corralon_menu_users_cache_v1',JSON.stringify([{id:'another-user',password:'wrong-password'},{id:'user-test',password:'test-password'}]));
 Object.defineProperty(w.crypto,'subtle',{value:crypto.webcrypto.subtle});Object.assign(w,{TextEncoder,TextDecoder,Headers,Request,Response});w.AbortSignal.timeout=AbortSignal.timeout;
 w.CORRALON_DISABLE_CATALOG_REALTIME=true;
 w.CorralonFunciones={menuSessionUser:()=>user,isMenuSessionActive:()=>!!user};w.matchMedia=()=>({matches:false,addListener(){},addEventListener(){}});
 w.CorralonCacheDB={get:async key=>store.get(key),set:async(key,value)=>store.set(key,structuredClone(value)),withLock:async(key,fn)=>fn()};
 const base=[{codigo:'000010',nombre:'PEGAMENTO',rubro:'PEGAMENTOS',precio:100,imagenes:[],activo:true,sqlEditRevision:6,stockSucursalProgresoRuta:5,stockSucursalCalle5Espana:2}],text=JSON.stringify(base),hash=crypto.createHash('sha256').update(text).digest('hex');
 const costs=JSON.stringify({articles:[{codigo:'000010',PrecioCpraCI:60,PorcGanMin:.4}],providers:[{id:'123',id_proveedor:'123',proveedor:'Proveedor prueba'}]}),costHash=crypto.createHash('sha256').update(costs).digest('hex'),key=crypto.randomBytes(32),nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),content=Buffer.concat([cipher.update(costs),cipher.final(),cipher.getAuthTag()]);
 const manifest={schema:1,version:hash,count:1,generatedAt:new Date().toISOString(),files:[{file:'a-'+hash+'.json',hash,count:1}],costs:{file:'costos-'+costHash+'.json',hash:costHash}};
 w.fetch=async(url,options={})=>{url=String(url);calls.push({url,options});let result;
  if(url.includes('supabase.co'))throw Error('La copia no debe consultar Supabase');
  if(url.includes('/documents/menuUsuarios/')){if(!network.firebaseAvailable)throw Error('Sin conexión al Menú');result={fields:{password:{stringValue:'test-password'}}};}
  else if(url.endsWith('manifest.json'))result=manifest;
  else if(url.includes('/costos-'))result={schema:1,nonce:nonce.toString('base64'),data:content.toString('base64')};
  else if(url.includes('/a-'))return new Response(text);
  else if(url.endsWith('/login')){if(JSON.parse(options.body).password!=='test-password')return Response.json({error:'Usuario o clave no válidos.'},{status:401});result={ok:true,token:'test-token',expires:Date.now()+100000,user:{id:'user-test'}};}
  else if(url.endsWith('/private-key'))result={ok:true,key:key.toString('base64')};
  else if(url.endsWith('/edits')){const sent=JSON.parse(options.body).articles[0];result={ok:true,version:1,edits:[{codigo:sent.codigo,detalle:sent.detalle,imagenes:[],revision:1,ceramico:false}]};}
  else if(url.endsWith('/budget/search'))result=[];
  else result={};return Response.json(result);
 };
 w.eval(read('index-sql-api.js'));w.eval(read('corralon-system.js'));assert.ok(w.CorralonSystem,w.__corralonSystemError?.message);w.eval(read('index-sql-prueba.js'));w.eval(read('index-cloudflare.js'));
 return{dom,w,store,calls,network,user:value=>user=value};
}
test('reutiliza la sesion de Menu sin formulario adicional y descifra costos sin guardarlos en claro',async()=>{const s=await setup();try{const rows=await s.w.CorralonSystem.catalog.load();assert.equal(rows[0].PrecioCpraCI,60);assert.equal(s.calls.filter(call=>call.url.endsWith('/login')).length,1);await s.w.CorralonSystem.catalog.load();assert.equal(s.calls.filter(call=>call.url.endsWith('/login')).length,1);const snapshot=s.store.get('index_sql_prueba_snapshot_v1');assert.equal(snapshot.rows[0].PrecioCpraCI,undefined);assert.equal(JSON.stringify([...s.store.values()]).includes('PrecioCpraCI'),false);assert.equal((await s.w.CorralonSystem.getProvidersCache())[0].id_proveedor,'123');}finally{s.dom.window.close()}});
test('sin sesion mantiene catalogo publico y no consulta costos ni login',async()=>{const s=await setup(false);try{const rows=await s.w.CorralonSystem.catalog.load();assert.equal(rows.length,1);assert.equal(rows[0].PrecioCpraCI,undefined);assert.equal(s.calls.some(call=>call.url.endsWith('/login')||call.url.includes('/costos-')),false);}finally{s.dom.window.close()}});
test('editor compartido conserva UI y guarda en Cloudflare sin escrituras Supabase',async()=>{const s=await setup();try{await s.w.CorralonSystem.catalog.load();await s.w.CorralonSystem.catalog.saveArticleEdits([{codigo:'000010',detalle:'Detalle de prueba',imagenes:[]}]);assert.equal((await s.w.CorralonSystem.catalog.load())[0].detalle,'Detalle de prueba');assert.equal(s.w.CorralonSystem.articleEditor.open('000010',{articles:await s.w.CorralonSystem.catalog.load()}),true);assert.ok(s.w.document.querySelector('.corralon-article-editor-host.is-open'));assert.equal(s.calls.some(call=>call.url.includes('supabase.co')),false);}finally{s.dom.window.close()}});
test('cambiar a sesion publica elimina costos de memoria y de nuevas lecturas',async()=>{const s=await setup();try{await s.w.CorralonSystem.catalog.load();s.user(null);assert.equal((await s.w.CorralonSystem.catalog.load())[0].PrecioCpraCI,undefined);}finally{s.dom.window.close()}});

test('guardar oculta el editor y dispara la animacion mientras la escritura sigue pendiente',async()=>{const s=await setup();try{const rows=await s.w.CorralonSystem.catalog.load(),animations=[];let finish,saved;const pending=new Promise(resolve=>finish=resolve);s.w.CorralonFunciones.animacionCarga=(state,message)=>animations.push({state,message});s.w.CorralonSystem.aridos.configure({saveArticleConfig:async()=>{}});s.w.CorralonSystem.articleEditor.configure({getArticles:()=>rows,save:async(_list,article)=>{saved=article;await pending;s.w.dispatchEvent(new s.w.CustomEvent('corralon:article-sync-success'));}});s.w.CorralonSystem.articleEditor.open('000010');const host=s.w.document.querySelector('.corralon-article-editor-host'),field=host.querySelector('[data-editor-field="detalle"]');field.value='Detalle conservado';host.querySelector('[data-editor-save]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(host.style.display,'none');assert.equal(host.getAttribute('aria-hidden'),'true');assert.equal(animations[0].state,'syncing');assert.equal(s.w.CorralonSystem.articleEditor.open('000010'),false);finish();for(let i=0;i<100&&host.style.display==='none';i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(saved.detalle,'Detalle conservado');assert.equal(host.classList.contains('is-open'),false);assert.equal(host.style.display,'');assert.equal(animations.at(-1).state,'success');}finally{s.dom.window.close()}});

test('un fallo de guardado vuelve a mostrar el editor con los cambios intactos',async()=>{const s=await setup();try{const rows=await s.w.CorralonSystem.catalog.load(),animations=[];let fail;const pending=new Promise((_resolve,reject)=>fail=reject);s.w.alert=()=>{};s.w.console.error=()=>{};s.w.CorralonFunciones.animacionCarga=state=>animations.push(state);s.w.CorralonSystem.aridos.configure({saveArticleConfig:async()=>{}});s.w.CorralonSystem.articleEditor.configure({getArticles:()=>rows,save:()=>pending});s.w.CorralonSystem.articleEditor.open('000010');const host=s.w.document.querySelector('.corralon-article-editor-host');host.querySelector('[data-editor-field="detalle"]').value='Cambio sin perder';host.querySelector('[data-editor-save]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(host.style.display,'none');fail(Error('Sin conexión'));for(let i=0;i<100&&host.style.display==='none';i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(host.classList.contains('is-open'),true);assert.equal(host.style.display,'');assert.equal(host.getAttribute('aria-hidden'),'false');assert.equal(host.querySelector('[data-editor-field="detalle"]').value,'Cambio sin perder');assert.equal(animations.at(-1),'error');}finally{s.dom.window.close()}});

test('la sesion real sin clave en snapshot usa solo el usuario correspondiente del cache del Menu',async()=>{const s=await setup();try{await s.w.CorralonSystem.catalog.load();const call=s.calls.find(call=>call.url.endsWith('/login'));assert.deepEqual(JSON.parse(call.options.body),{userId:'user-test',password:'test-password'});}finally{s.dom.window.close()}});

test('un problema de sesion interna no impide cargar ni buscar productos',async()=>{const s=await setup();try{s.w.localStorage.removeItem('corralon_menu_users_cache_v1');s.network.firebaseAvailable=false;const rows=await s.w.CorralonSystem.catalog.load();assert.equal(rows.length,1);assert.equal(rows[0].PrecioCpraCI,undefined);assert.equal((await s.w.IndexSqlPrueba.query({termino:'pegamento'})).length,1);assert.equal(s.calls.some(call=>call.url.endsWith('/private-key')),false);await assert.rejects(s.w.IndexSqlApi.request('edits',{articles:[]}),/Sin conexión/);}finally{s.dom.window.close()}});

test('el guard del Menu puede limpiar todas las claves de cache sin impedir guardar una oferta en Cloudflare',async()=>{const s=await setup();try{const clean=[{id:'user-test',nombre:'Usuario prueba',nivel:'administrador'}];s.w.localStorage.setItem('corralon_menu_users_cache_v1',JSON.stringify(clean));await s.w.CorralonSystem.catalog.load();await s.w.CorralonSystem.catalog.saveArticleEdits([{codigo:'000010',oferta:true,ofertaPct:10,imagenes:[]}]);assert.equal(s.calls.filter(call=>call.url.includes('/documents/menuUsuarios/')).length,1);const sent=JSON.parse(s.calls.find(call=>call.url.endsWith('/edits')).options.body);assert.equal(sent.articles[0].oferta,true);assert.equal(s.w.localStorage.getItem('corralon_menu_users_cache_v1'),JSON.stringify(clean));assert.equal(s.w.sessionStorage.getItem('corralon_index_sql_auth_v1').includes('test-password'),false);}finally{s.dom.window.close()}});

test('una clave vieja en cache se revalida con el registro actual del Menu sin pedir otro login',async()=>{const s=await setup();try{s.w.localStorage.setItem('corralon_menu_users_cache_v1',JSON.stringify([{id:'user-test',password:'old-password'}]));const rows=await s.w.CorralonSystem.catalog.load();assert.equal(rows[0].PrecioCpraCI,60);assert.equal(s.calls.filter(call=>call.url.endsWith('/login')).length,2);assert.equal(s.calls.filter(call=>call.url.includes('/documents/menuUsuarios/')).length,1);}finally{s.dom.window.close()}});


test('las consultas originales de categoria y rubros reciben el formato esperado desde la lista local',async()=>{const s=await setup(false);try{const url='https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/rest/v1/catalogo_articulos_publico?activo=eq.true&or=(rubro.ilike.*cemento*,codigo.in.("000010"))&order=nombre.asc,codigo.asc&limit=250&offset=0';const response=await s.w.fetch(url),rows=await response.json();assert.equal(response.status,200);assert.equal(rows.length,1);assert.equal(rows[0].precio_venta,100);assert.equal(rows[0].stock_progreso,5);const normalized=s.w.CorralonSystem.catalog.fromSupabase(rows[0]);assert.equal(normalized.precio,100);assert.equal(normalized.stockSucursalCalle5Espana,2);const requestCount=s.calls.length;assert.equal((await(await s.w.fetch(url)).json()).length,1);assert.equal(s.calls.length,requestCount);const rubros=await(await s.w.fetch('https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/rest/v1/catalogo_articulos_publico?select=rubro&rubro=gt.A&limit=1000')).json();assert.deepEqual(rubros,[{rubro:'PEGAMENTOS'}]);}finally{s.dom.window.close()}});

test('el RPC original de busqueda y el buscador compartido usan Cloudflare sin red Supabase',async()=>{const s=await setup();try{const response=await s.w.fetch('https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/rest/v1/rpc/buscar_catalogo_publico_reducido',{method:'POST',body:JSON.stringify({p_termino:'pegamento',p_limite:600})});assert.equal((await response.json())[0].precio_venta,100);const budgets=await s.w.fetch('https://tizyjenayrcdkcodsjnc.supabase.co/rest/v1/rpc/buscar_presupuestos_web',{method:'POST',body:JSON.stringify({p_consulta:'pegamento'})});assert.equal(budgets.status,200);assert.ok(s.calls.some(call=>call.url.endsWith('/budget/search')));assert.equal(s.calls.some(call=>call.url.includes('supabase.co')),false);const unsupported=await s.w.fetch('https://tizyjenayrcdkcodsjnc.supabase.co/rest/v1/unknown',{method:'POST',body:'{}'});assert.equal(unsupported.status,501);assert.equal(s.calls.some(call=>call.url.includes('supabase.co')),false);}finally{s.dom.window.close()}});


test('la copia elimina Prode conservando el resto de controles y el icono de compartir productos',()=>{const {VirtualConsole}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');const original=new JSDOM(read('index.html'),{virtualConsole:new VirtualConsole()}),copy=new JSDOM(read('index - copia.html'),{virtualConsole:new VirtualConsole()});try{const ids=dom=>[...new Set([...dom.window.document.querySelectorAll('[id]')].map(node=>node.id))].sort();assert.deepEqual(ids(copy),ids(original).filter(id=>!/^prode/i.test(id)));assert.ok(copy.window.document.querySelector('#productDetailShare .product-share-mark'));assert.doesNotMatch(read('index - copia.html'),/prode|espn/i);assert.doesNotMatch(read('index-cloudflare.js'),/prode|espn/i);assert.match(read('index - copia.html'),/src="corralon-system\.js/);}finally{original.window.close();copy.window.close()}});

test('conserva revision al convertir categorias y al guardar desde una vista anterior',async()=>{const s=await setup();try{const url='https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/rest/v1/catalogo_articulos_publico?select=codigo,nombre,precio_venta&limit=250';const raw=(await(await s.w.fetch(url)).json())[0];assert.equal(raw.sqlEditRevision,6);assert.equal(s.w.CorralonSystem.catalog.fromSupabase(raw).sqlEditRevision,6);await s.w.CorralonSystem.catalog.saveArticleEdits([{codigo:'000010',detalle:'cambio',imagenes:[]}]);assert.equal(JSON.parse(s.calls.find(call=>call.url.endsWith('/edits')).options.body).articles[0].sqlEditRevision,6);}finally{s.dom.window.close()}});

test('stock numerico o cientifico conserva el valor SQL sin convertirlo en -2.98',()=>{const html=read('index - copia.html'),body=html.slice(html.indexOf('function obtenerStockInfo('),html.indexOf('function obtenerStockInfo(')+5000),start=body.indexOf('const parseStockNumber = ')+25,end=body.indexOf('\n  };',start)+4,parse=eval('('+body.slice(start,end).trim().replace(/;$/,'' )+')');assert.equal(parse(-2.98023223876953e-7),0);assert.equal(parse('-2.98023223876953e-7'),0);assert.equal(parse(-2.98),-2.98);assert.equal(parse('1.234,56'),1234.56);});

test('editor reutilizado deja de ser inert al abrir sobre el importador y permite cerrar',async()=>{const s=await setup();try{const editor=s.w.CorralonSystem.articleEditor,articles=await s.w.CorralonSystem.catalog.load();assert.equal(editor.open('000010',{articles}),true);const host=s.w.document.querySelector('.corralon-article-editor-host');editor.close();host.inert=true;host.setAttribute('inert','');let closed=false;assert.equal(editor.open('000010',{articles,operation:{onClose(){closed=true}}}),true);assert.equal(host.inert,false);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(s.w.document.activeElement,host.querySelector('[data-editor-field="detalle"]'));host.querySelector('[data-editor-close]').click();assert.equal(closed,true);assert.equal(host.classList.contains('is-open'),false);}finally{s.dom.window.close()}});


test('editor de Carga Stock conserva campos, etiquetas y cierre al distribuir datos y foto en columnas',async()=>{
 const s=await setup();try{
  s.w.document.body.dataset.pageTheme='cargastock';
  const rows=await s.w.CorralonSystem.catalog.load();
  let closed=false;
  const editor=s.w.CorralonSystem.articleEditor;
  assert.equal(editor.open('000010',{articles:rows,operation:{onClose(){closed=true}}}),true);
  const host=s.w.document.querySelector('.corralon-article-editor-host');
  assert.ok(host.classList.contains('article-editor-reference'));
  for(const field of ['codigo','codigoProveedor','nombre','rubro','precio'])assert.equal(host.querySelectorAll('[data-editor-info="'+field+'"]').length,1);
  assert.equal(host.querySelector('[data-editor-info="nombre"]').textContent,'PEGAMENTO');
  host.querySelector('[data-editor-field="detalle"]').value='Detalle conservado';
  host.querySelector('[data-editor-field="tags"]').value='obra, pegamento';
  const offer=host.querySelector('[data-editor-chip="oferta"]');offer.click();
  assert.equal(offer.classList.contains('is-active'),true);
  assert.equal(host.querySelector('[data-editor-extra="oferta"]').hidden,false);
  assert.equal(host.querySelector('[data-editor-field="detalle"]').value,'Detalle conservado');
  host.querySelector('[data-editor-additional-open]').click();
  assert.equal(host.querySelector('[data-editor-additional-dialog]').classList.contains('is-open'),true);
  host.querySelector('[data-editor-additional-close]').click();
  host.querySelector('[data-editor-images-open]').click();
  assert.equal(host.querySelector('[data-editor-images-dialog]').classList.contains('is-open'),true);
  host.querySelector('[data-editor-images-close]').click();
  assert.equal(host.querySelector('[data-editor-apply-open]').hidden,true);
  host.querySelector('[data-editor-close]').click();
  assert.equal(closed,true);assert.equal(host.classList.contains('is-open'),false);
 }finally{s.dom.window.close()}
});


test('catálogo común y estacional usan el mismo editor y cargan una sola hoja compartida',async()=>{
 for(const seasonal of [false,true]){
  const s=await setup();try{
   if(seasonal)s.w.document.body.classList.add('halloween-index');
   const rows=await s.w.CorralonSystem.catalog.load(),editor=s.w.CorralonSystem.articleEditor;
   editor.open('000010',{articles:rows});
   const host=s.w.document.querySelector('.corralon-article-editor-host');
   assert.equal(host.classList.contains('article-editor-reference'),true);
   assert.equal(host.querySelector('[data-editor-info="nombre"]').textContent,'PEGAMENTO');
   assert.equal(host.querySelector('[data-editor-apply-open]').hidden,false);
   host.querySelector('[data-editor-images-open]').click();
   assert.equal(host.querySelector('[data-editor-images-dialog]').classList.contains('is-open'),true);
   host.querySelector('[data-editor-images-close]').click();
   editor.close();editor.open('000010',{articles:rows});
   assert.equal(s.w.document.querySelectorAll('link[href*="theme-corralon.css"]').length,1);
   assert.equal(host.querySelectorAll('.article-editor-reference-columns').length,1);
  }finally{s.dom.window.close()}
 }
});

test('terminar el guardado no mueve el foco ni el cursor del campo que el usuario esta editando',async()=>{
 const s=await setup();try{
 const rows=await s.w.CorralonSystem.catalog.load();let finish;const pending=new Promise(resolve=>finish=resolve);
 s.w.CorralonFunciones.animacionCarga=()=>{};s.w.CorralonSystem.aridos.configure({saveArticleConfig:async()=>{}});
 s.w.CorralonSystem.articleEditor.configure({getArticles:()=>rows,save:()=>pending});
 const original=s.w.document.createElement('input'),current=s.w.document.createElement('input');s.w.document.body.append(original,current);original.focus();
 s.w.CorralonSystem.articleEditor.open('000010',{returnFocus:original});const host=s.w.document.querySelector('.corralon-article-editor-host');host.querySelector('[data-editor-save]').click();
 await new Promise(resolve=>setTimeout(resolve,0));current.value='12345';current.focus();current.setSelectionRange(2,2);finish();
 for(let i=0;i<100&&host.style.display==='none';i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(host.classList.contains('is-open'),false);assert.equal(s.w.document.activeElement,current);assert.equal(current.selectionStart,2);assert.equal(current.selectionEnd,2);
 }finally{s.dom.window.close()}
});
