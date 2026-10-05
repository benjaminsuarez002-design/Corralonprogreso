// Durable FIFO for the local importer. One worker owns SQL and web publication.
const key='corralon_local_article_sync_queue_v1';
let jobs=[],ready,writing=Promise.resolve(),running=false,token='';
const callbacks=new Map();
const cache=()=>window.CorralonSystem.localCache;
function persist() {
  const snapshot=structuredClone(jobs);
  writing=writing.catch(()=>{}).then(()=>cache().write(key,snapshot));
  return writing;
}
async function request(path,body) {
  const response=await fetch(`/api/local-articles/${path}`,{cache:'no-store',...(body ? {method:'POST',headers:{'Content-Type':'application/json','X-Local-Articles-Token':token},body:JSON.stringify(body)} : {})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error || 'No respondió el importador local.');error.status=response.status;throw error;}
  return data;
}
async function sqlRequest(path,body) {
  if(!token)token=(await request('catalog')).token;
  try{return await request(path,body);}catch(error){
    if(error.status!==403)throw error;
    token=(await request('catalog')).token;
    return request(path,body);
  }
}
function progress(message,percent) {
  const waiting=jobs.filter(job=>job.state==='queued').length;
  window.CorralonSystem.articleSync.set('syncing',message+(waiting ? ` · ${waiting} en cola` : ''),{progress:percent});
}
async function load() {
  if(!ready)ready=(async()=>{
    jobs=await cache().read(key) || [];
    jobs.forEach(job=>{if(job.state!=='error')job.state='queued';});
  })();
  return ready;
}
async function retry() {
  jobs.filter(job=>job.state==='error').forEach(job=>{job.state='queued';delete job.error;});
  await persist();start();
}
function showResult() {
  const errors=jobs.filter(job=>job.state==='error');
  window.CorralonSystem.articleSync.set(errors.length ? 'error' : 'success',errors.length ? `${errors.length} cargas pendientes: ${errors[0].error}` : 'Cargas completadas',{progress:100,retry:errors.length ? retry : null,cancel:errors.length ? cancelFailed : null});
}
async function cancelFailed() {
  const canceled=jobs.filter(job=>job.state==='error');
  const saved=canceled.some(job=>job.rows.some(row=>row.sqlSaved));
  jobs=jobs.filter(job=>job.state!=='error');
  canceled.forEach(job=>callbacks.delete(job.id));
  await persist();
  window.CorralonSystem.articleSync.set('success',saved ? 'Carga pendiente cancelada. Lo ya guardado en SQL se conserva.' : 'Carga pendiente cancelada.');
}
async function process(job) {
  job.state='running';await persist();
  const sqlRows=job.rows.filter(row=>!row.sqlSaved);
  if(sqlRows.length){
    progress('Guardando artículos en SQL…',5);
    const result=await sqlRequest('apply',{operation:job.operation,provider:job.provider,rows:sqlRows.map(r=>({mode:r.mode,id:r.id,version:r.version,codigo:r.codigo,descripcion:r.descripcion,costo:r.costo,rubro:r.rubro,iva:r.iva,margen:r.mode==='update' && Math.abs(r.margen-r.originalMargin)<.000001 ? null : r.margen}))});
    sqlRows.forEach((row,index)=>{row.sqlSaved={id:result.rows[index]?.id || row.id};});
    await persist();
    try{callbacks.get(job.id)?.({...result,importados:result.nuevos+result.actualizados,directSql:true},structuredClone(sqlRows));}catch(error){console.warn('SQL guardado; no se pudo refrescar la pantalla.',error);}
  }
  job.rows=job.rows.filter(row=>row.loadWeb && row.webDraft);await persist();
  const total=job.rows.length;let done=0;
  while(job.rows.length){
    const batch=job.rows.slice(0,100);let next=0,finished=0,uploadError;
    progress('Subiendo fotos en segundo plano…',20+70*done/total);
    await Promise.all(Array.from({length:Math.min(4,batch.length)},async()=>{
      while(next<batch.length){
        const row=batch[next++];
        try{
          row.webDraft.codigo=row.webDraft.idart=row.sqlSaved.id;
          await window.CorralonSystem.articleEditor.publishImages(row.webDraft,row.sqlSaved.id,persist);
          finished++;progress(`Fotos listas: ${done+finished}/${total}`,20+60*(done+finished)/total);
        }catch(error){uploadError ||= error;}
      }
    }));
    if(uploadError)throw uploadError;
    progress(`Publicando ${batch.length} fichas en Index…`,85);
    await sqlRequest('publish',{articles:batch.map(row=>({id:row.sqlSaved.id,article:row.webDraft}))});
    const published=new Set(batch);job.rows=job.rows.filter(row=>!published.has(row));done+=batch.length;
    await persist();
  }
}
function start() {
  if(running)return;
  running=true;
  (async()=>{
    try{
      let job;
      while((job=jobs.find(item=>item.state==='queued'))){
        try{await process(job);jobs=jobs.filter(item=>item!==job);callbacks.delete(job.id);await persist();}
        catch(error){job.state='error';job.error=(job.rows.some(row=>row.sqlSaved) ? 'SQL guardado. ' : '')+error.message;await persist();}
      }
      showResult();
    }catch(error){window.CorralonSystem.articleSync.set('error',error.message,{retry});}
    finally{running=false;if(jobs.some(job=>job.state==='queued'))start();}
  })();
}
export async function enqueue(input,onImported,localToken) {
  await load();
  if(localToken)token=localToken;
  const existing=jobs.find(job=>job.id===input.operation);
  if(existing){if(existing.state==='error')await retry();return existing.id;}
  const job={...structuredClone(input),id:input.operation,state:'preparing'};
  jobs.push(job);callbacks.set(job.id,onImported);
  try{await persist();job.state='queued';await persist();}
  catch(error){jobs=jobs.filter(item=>item!==job);callbacks.delete(job.id);throw error;}
  if(running)progress('Carga agregada a la cola…',null);
  start();return job.id;
}
export async function resumeQueue() {await load();if(jobs.some(job=>job.state==='queued'))start();else if(jobs.length)showResult();}
