/* Servicios de la copia. La sesión y los presupuestos no se mezclan con los oficiales. */
(() => {
  'use strict';
  const base='https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/api/index-prueba/';
  const storageKey='corralon_index_sql_auth_v1';let loginPending=null;
  const user=()=>window.CorralonFunciones?.menuSessionUser?.();
  async function menuPassword(current,refresh=false){
    if(!refresh){
      if(current.password)return current.password;
      try{const users=JSON.parse(localStorage.getItem('corralon_menu_users_cache_v1')||'[]'),cached=Array.isArray(users)?users.find(entry=>entry.id===current.id)?.password:'';if(cached)return cached;}catch{}
    }
    // El guard del Menú elimina las claves de la caché. Consultar el mismo registro
    // que ya usa el Menú y mantener la clave solo durante la validación automática.
    const response=await fetch('https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/menuUsuarios/'+encodeURIComponent(current.id)+'?key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('No se pudo validar la sesión existente del Menú. Intentá nuevamente cuando haya conexión.');
    const password=(await response.json()).fields?.password?.stringValue;
    if(!password)throw Error('No se pudo recuperar la sesión interna del Menú. Abrí el Menú en este mismo navegador para habilitar las herramientas internas.');
    return password;
  }
  function session(){try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');return saved?.user?.id===user()?.id&&saved.expires>Date.now()?saved:null;}catch{return null;}}
  async function send(route,data,token){
    const response=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(30000)});
    const payload=await response.json().catch(()=>({error:'Respuesta inválida del servicio de prueba.'}));
    if(!response.ok){const error=new Error(payload.error||'No se pudo completar la operación.');error.status=response.status;throw error;}return payload;
  }
  async function login(){
    const active=session();if(active)return active;if(loginPending)return loginPending;
    loginPending=(async()=>{
      const current=user();if(!current?.id)throw Error('Iniciá sesión desde el Menú para usar las herramientas internas.');
      let result;
      try{result=await send('login',{userId:current.id,password:await menuPassword(current)});}
      catch(error){if(error.status!==401)throw error;result=await send('login',{userId:current.id,password:await menuPassword(current,true)});}
      if(user()?.id!==current.id)throw Error('La sesión del Menú cambió durante la operación. Volvé a intentarlo.');
      sessionStorage.setItem(storageKey,JSON.stringify(result));return result;
    })();
    try{return await loginPending;}finally{loginPending=null;}
  }
  async function request(route,data){const active=await login();try{return await send(route,data,active.token);}catch(error){if(error.status!==401)throw error;sessionStorage.removeItem(storageKey);const renewed=await login();return send(route,data,renewed.token);}}
  let reservation=null;
  async function reserve(){
    const requestId=crypto.randomUUID();const result=await send('budget/reserve',{requestId});reservation=result;
    sessionStorage.setItem('index_sql_budget_claim|'+result.numero_completo,result.claim);return result;
  }
  async function saveBudget(record){const claim=reservation?.numero_completo===record.numero?reservation.claim:sessionStorage.getItem('index_sql_budget_claim|'+record.numero);if(!claim)throw Error('Falta la reserva del presupuesto de prueba.');return send('budget/save',{record,claim});}
  window.IndexSqlApi={request,reserve,saveBudget,user,searchBudgets:(query,from,to)=>request('budget/search',{query,from,to}),saveArido:(codigo,config)=>request('arido',{codigo,config}),saveFreight:config=>request('freight',config)};
})();
