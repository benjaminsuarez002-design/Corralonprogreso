// Una escritura atómica: no lee el contador antes de incrementarlo.
(function(root){
  const document='projects/corralon-progreso/databases/(default)/documents/configuracion/catalogo_version';
  const endpoint='https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents:commit?key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0';
  async function publish(fetcher=root.fetch.bind(root)){
    const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({writes:[{transform:{document,fieldTransforms:[{fieldPath:'version',increment:{integerValue:'1'}}]}}]})});
    const result=await response.json();
    if(!response.ok)throw new Error('La lista quedó en Supabase, pero falló el aviso de Firebase: '+(result.error?.message||response.status));
    return Number(result.writeResults?.[0]?.transformResults?.[0]?.integerValue||0);
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={publish};if(require.main===module)publish().then(version=>console.log('[CATALOGO] Aviso Firebase: versión '+version)).catch(error=>{console.error(error.message);process.exitCode=1});}
  else root.CorralonCatalogVersionPublish=publish;
})(globalThis);
