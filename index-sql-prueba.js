/* Adaptador exclusivo de index - copia.html. No modifica los modulos oficiales. */
(() => {
  'use strict';
  const system=window.CorralonSystem,db=window.CorralonCacheDB;
  const endpoint=new URL('catalogo-sql-prueba/',location.href);
  const publishedEndpoint=new URL('https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/catalogo-sql-prueba/');
  const cacheKey='index_sql_prueba_snapshot_v1';
  let current=null,pending=null,refresh=null,timer=null;
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
        const next={manifest,chunks,rows};await db.set(cacheKey,next);current=next;show(false);return current;
      }catch(error){if(!current)throw error;console.warn('Se conserva la ultima lista SQL:',error.message);show(true);return current;}
    });
    try{return await pending;}finally{pending=null;}
  }
  function show(offline){let label=document.getElementById('indexSqlStatus');if(!label){label=document.createElement('div');label.id='indexSqlStatus';label.style.cssText='position:fixed;left:8px;bottom:78px;z-index:9000;background:#173c2f;color:white;padding:5px 10px;border-radius:7px;font:12px Arial;max-width:85vw;pointer-events:none';document.body.appendChild(label);}label.textContent='Prueba SQL · '+(offline?'última lista guardada · ':'')+new Date(current.manifest.generatedAt).toLocaleString('es-AR');}
  async function rows(){return (current||await sync()).rows;}
  function filter(list,term){const words=normalized(term).match(/[\p{L}\p{N}]+/gu)||[];return list.filter(row=>{const haystack=normalized([row.codigo,row.idartprov,row.nombre,row.rubro,...(row.tagsOcultos||[])].join(' '));return words.every(word=>haystack.includes(word));});}
  async function query({termino='',codigos=[],portada=false,limite=400}={}){
    const list=await rows();if(codigos.length&&!portada){const codes=new Set(codigos.map(String));return list.filter(row=>codes.has(row.codigo)).slice(0,limite);}
    if(termino)return filter(list,termino).slice(0,limite);
    if(portada){const codes=new Set(codigos.map(String));return [...list].sort((a,b)=>Number(codes.has(b.codigo)||b.destacado||b.masVendido||b.oferta)-Number(codes.has(a.codigo)||a.destacado||a.masVendido||a.oferta)).slice(0,limite);}
    return list.slice(0,limite);
  }
  async function check(){if(document.hidden)return;const previous=current?.manifest.version;await sync();if(previous&&previous!==current?.manifest.version)await refresh?.(await meta());}
  async function meta(){const snapshot=current||await sync();return{version:snapshot.manifest.version,patch_version:0,total_articulos:snapshot.rows.length};}
  function start(){if(timer)return;timer=setInterval(()=>check().catch(console.warn),60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check().catch(console.warn)});window.addEventListener('online',()=>check().catch(console.warn));}
  const readonly=()=>{throw Error('Esta es una prueba de lectura SQL. La edición del catálogo oficial sigue en su página habitual.');};
  system.catalog={...system.catalog,load:rows,cachedRows:rows,cachedArticle:async code=>(await rows()).find(row=>row.codigo===String(code)),loadProgressive:async()=>{const list=await rows();return{initialRows:list,complete:Promise.resolve(list),version:(await meta()).version};},saveArticleEdits:readonly};
  system.catalogRealtime={getMeta:meta,configure:options=>{refresh=options.refresh;},start,publishVersion:readonly};
  window.IndexSqlPrueba={rows,query,meta,start,sync,normalized};
  // El editor original escribe en Supabase. En esta prueba se bloquea antes de editar.
  system.articleEditor.open=()=>{alert('Prueba SQL: edición deshabilitada. Los precios y el stock se actualizan desde SQL.');};
})();
