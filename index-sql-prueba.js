/* Adaptador exclusivo de index - copia.html. No modifica los modulos oficiales. */
(() => {
  'use strict';
  const system=window.CorralonSystem,db=window.CorralonCacheDB;
  const endpoint=new URL('catalogo-sql-prueba/',location.href);
  const publishedEndpoint=new URL('https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/catalogo-sql-prueba/');
  const cacheKey='index_sql_prueba_snapshot_v1';
  let current=null,pending=null,refresh=null,timer=null,costVersion='',costUser='',costRows=new Map(),costKey=null,providers=[],costRetryAt=0;
  const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  async function json(url){const response=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('No se pudo leer la lista SQL publicada.');return response.json();}
  function valid(snapshot){return snapshot?.manifest?.schema===1&&Array.isArray(snapshot.rows)&&snapshot.rows.length===snapshot.manifest.count;}
  async function sync(){
    if(pending)return pending;
    pending=db.withLock('index-sql-prueba-sync',async()=>{
      const saved=await db.get(cacheKey);if(valid(saved))current=saved;
      try {
        let source=endpoint,manifest;
        try{manifest=await json(new URL('manifest.json',source));}
        catch(error){if(source.href===publishedEndpoint.href)throw error;source=publishedEndpoint;manifest=await json(new URL('manifest.json',source));}
        if(manifest.schema!==1||!Array.isArray(manifest.files)||!Number.isInteger(manifest.count)||manifest.count<1||manifest.files.length>256)throw Error('Manifiesto SQL invalido.');
        if(current?.manifest.version===manifest.version){show(false);return current;}
        const chunks={},rows=[];let index=0;
        await Promise.all(Array.from({length:6},async()=>{
          while(index<manifest.files.length){
            const file=manifest.files[index++];
            if(!/^[a-f0-9]-[a-f0-9]{64}\.json$/.test(file.file)||file.file!==file.file.slice(0,2)+file.hash+'.json')throw Error('Fragmento SQL invalido.');
            let data=current?.chunks?.[file.hash];
            if(!data){const response=await fetch(new URL(file.file,source),{cache:'force-cache',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Actualizacion SQL incompleta.');const content=await response.text();if(crypto.subtle){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content))),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==file.hash)throw Error('No coincide el contenido SQL publicado.');}data=JSON.parse(content);}
            if(!Array.isArray(data)||data.length!==file.count)throw Error('Fragmento SQL incompleto.');
            chunks[file.hash]=data;
          }
        }));
        for(const file of manifest.files)rows.push(...chunks[file.hash]);
        if(rows.length!==manifest.count||new Set(rows.map(row=>row.codigo)).size!==rows.length)throw Error('Catalogo SQL incompleto o duplicado.');
        rows.sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
        let config={};
        if(manifest.config){if(!/^config-[a-f0-9]{64}\.json$/.test(manifest.config.file))throw Error('Configuración de catálogo inválida.');config=await json(new URL(manifest.config.file,source));}
        const next={manifest,chunks,rows,config,source:source.href};await db.set(cacheKey,next);current=next;show(false);return current;
      }catch(error){if(!current)throw error;console.warn('Se conserva la ultima lista SQL:',error.message);show(true);return current;}
    });
    try{return await pending;}finally{pending=null;}
  }
  function show(offline){if(document.documentElement){document.documentElement.dataset.catalogoSqlActualizado=current.manifest.generatedAt;document.documentElement.dataset.catalogoSqlOffline=String(offline);}}
  function decorateConfig(snapshot){
    // La copia limpia conserva la lectura y edición original de áridos en Firebase.
    if(window.IndexCloudflare)return;
    if(snapshot.config?.aridos)system.aridos?.setConfigMap?.(new Map(snapshot.config.aridos.map(row=>[row.codigo,row])));
    if(snapshot.config?.freight)system.aridos?.setFreightConfig?.(snapshot.config.freight);
  }
  async function internalCosts(snapshot){
    const user=window.IndexSqlApi?.user?.();
    if(!user?.id){costRows.clear();costKey=null;costUser='';costVersion='';providers=[];costRetryAt=0;return;}
    if(costUser!==user.id){costRows.clear();costKey=null;costVersion='';costUser=user.id;costRetryAt=0;}
    if(Date.now()<costRetryAt)return;
    if(!snapshot.manifest.costs||costVersion===snapshot.manifest.costs.hash)return;
    if(!crypto.subtle)throw Error('Para usar costos internos abrí la copia por HTTPS o localhost.');
    const descriptor=snapshot.manifest.costs;
    if(!/^costos-[a-f0-9]{64}\.json$/.test(descriptor.file))throw Error('Archivo de costos inválido.');
    costKey||=(await window.IndexSqlApi.request('private-key')).key;
    const cacheName='index_sql_encrypted_costs|'+descriptor.hash;
    let encrypted=await db.get(cacheName);
    if(!encrypted){encrypted=await json(new URL(descriptor.file,snapshot.source||endpoint));await db.set(cacheName,encrypted);}
    const bytes=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
    const key=await crypto.subtle.importKey('raw',bytes(costKey),'AES-GCM',false,['decrypt']);
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(encrypted.nonce)},key,bytes(encrypted.data));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',clear)),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(hash!==descriptor.hash)throw Error('El archivo de costos no coincide con la versión.');
    const payload=JSON.parse(new TextDecoder().decode(clear));
    costRows=new Map((Array.isArray(payload)?payload:payload.articles).map(row=>[row.codigo,row]));providers=payload.providers||[];costVersion=descriptor.hash;
  }
  async function rows(){
    const snapshot=current||await sync();decorateConfig(snapshot);
    try{await internalCosts(snapshot);}catch(error){costRows.clear();costKey=null;costVersion='';providers=[];costRetryAt=Date.now()+30000;console.warn('La lista SQL está disponible; no se pudieron cargar los costos internos:',error.message);}
    return snapshot.rows.map(row=>({...row,...(costRows.get(row.codigo)||{})}));
  }
  function filter(list,term){const words=normalized(term).match(/[\p{L}\p{N}]+/gu)||[];return list.filter(row=>{const haystack=normalized([row.codigo,row.idartprov,row.nombre,row.rubro,...(row.tagsOcultos||[])].join(' '));return words.every(word=>haystack.includes(word));});}
  async function query({termino='',codigos=[],portada=false,limite=400}={}){
    const list=await rows();if(codigos.length&&!portada){const codes=new Set(codigos.map(String));return list.filter(row=>codes.has(row.codigo));}
    if(termino)return filter(list,termino);
    if(portada){const codes=new Set(codigos.map(String));return [...list].sort((a,b)=>Number(codes.has(b.codigo)||b.destacado||b.masVendido||b.oferta)-Number(codes.has(a.codigo)||a.destacado||a.masVendido||a.oferta)).slice(0,limite);}
    return list.slice(0,limite);
  }
  async function check(){
    if(document.hidden)return;const previous=current?.manifest.version;await sync();
    if(previous&&previous!==current?.manifest.version){
      const metadata=await meta();
      if(window.IndexCloudflare&&window.IndexSqlApi?.user?.()?.id)window.dispatchEvent(new CustomEvent('corralon:catalog-ready',{detail:{rows:await rows(),version:metadata.version}}));
      await refresh?.(metadata);
    }
  }
  async function meta(){const snapshot=current||await sync();return{version:Date.parse(snapshot.manifest.generatedAt),patch_version:0,total_articulos:snapshot.rows.length};}
  function start(){if(timer)return;timer=setInterval(()=>check().catch(console.warn),60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check().catch(console.warn)});window.addEventListener('online',()=>check().catch(console.warn));}
  async function saveArticleEdits(articles){
    if(!current)await sync();
    const known=new Map(current.rows.map(row=>[row.codigo,row]));
    articles=articles.map(article=>({...article,sqlEditRevision:article.sqlEditRevision??known.get(article.codigo)?.sqlEditRevision??0}));
    const result=await window.IndexSqlApi.request('edits',{articles});
    const edits=new Map(result.edits.map(edit=>[edit.codigo,edit]));
    const names={tags_ocultos:'tagsOcultos',foto_url:'fotoUrl',oferta_pct:'ofertaPct',oferta_hasta:'ofertaHasta',mas_vendido:'masVendido',acceso_rapido:'accesoRapido',ceramico_m2:'ceramicoM2',ceramico_placas:'ceramicoPlacas',edicion_updated_at:'edicionUpdatedAt',revision:'sqlEditRevision'};
    current.rows=current.rows.map(row=>{const edit=edits.get(row.codigo);if(!edit)return row;const mapped={...row,...edit};for(const[from,to]of Object.entries(names))mapped[to]=edit[from];return mapped;});
    // No guardar filas decoradas con costos en la caché pública.
    await db.set(cacheKey,current);
    return{...result,articles:(await rows()).filter(row=>edits.has(row.codigo))};
  }
  Object.assign(system.catalog,{load:rows,cachedRows:rows,cachedArticle:async code=>(await rows()).find(row=>row.codigo===String(code)),fetchArticle:async code=>(await rows()).find(row=>row.codigo===String(code)),fetchSupabaseRows:rows,fetchCodeIndexRows:rows,refresh:async()=>{await sync();return rows();},loadProgressive:async()=>{const list=await rows();return{initialRows:list,complete:Promise.resolve(list),version:(await meta()).version};},saveArticleEdits,saveArticleEdit:async article=>{const result=await saveArticleEdits([article]);return{...result,article:result.articles[0]};}});
  Object.assign(system.catalogRealtime,{getMeta:meta,configure:options=>{refresh=options.refresh;},start,publishVersion:async()=>meta()});
  system.getProvidersCache=async()=>{await rows();return providers;};
  system.articleEditor.publishCatalog=saveArticleEdits;
  Object.assign(system.catalogEditorSession||{},{current:()=>window.IndexSqlApi?.user?.()||null,saveArticles:saveArticleEdits,saveArticle:article=>saveArticleEdits([article])});
  window.IndexSqlPrueba={rows,query,meta,start,sync,normalized};
})();
