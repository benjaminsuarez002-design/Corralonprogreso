(function(){
  if(window.CorralonSaleReviews)return;
  const KEY='corralon_ventas_revision_v1',SEEN='corralon_ventas_revision_vistas_v1';
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(v)||0);
  const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return{}}};
  const user=()=>read('corralon_menu_active_user_snapshot_v1');
  const isBenja=()=>String(user().nivel||'').trim().toLowerCase()==='administrador';
  const inBilling=()=>{const url=new URL(location.href);return ['gestion.html','facturacion.html'].includes(url.pathname.split('/').pop())&&(!url.hash||url.hash==='#facturacion')&&!['receipts','invoice-consult','caja','sql'].includes(document.body.dataset?.systemSection);};
  let requestedOpened=false,adapters=null,busy=false,unsubscribe=null,starting=false,notifications=[],localPendingDrafts=[],firebaseTools=null,flushBusy=false;
  const style=document.createElement('style');style.textContent=`.sale-review-overlay{position:fixed;inset:0;z-index:2147483000;background:#000b;display:flex;align-items:center;justify-content:center;padding:24px}.sale-review-panel{background:white;color:#151515;border:8px solid #e00000;border-radius:18px;padding:28px;width:min(920px,94vw);max-height:90vh;overflow:auto;font:18px Arial}.sale-review-panel h2{color:#d00000;font-size:clamp(30px,4vw,52px);margin:0 0 20px}.sale-review-panel p{line-height:1.4}.sale-review-panel button,.sale-review-panel a{display:inline-block;font:bold 18px Arial;padding:14px;margin:8px;border:1px solid #bbb;border-radius:8px;cursor:pointer}.sale-review-panel button.primary{background:#df0000;color:white}.sale-review-panel table{border-collapse:collapse;width:100%;font-size:15px}.sale-review-panel td,.sale-review-panel th{border:1px solid #ddd;padding:7px}.sale-review-bell{position:fixed;right:16px;top:12px;z-index:2147482999;background:#d00000;color:white;padding:8px 12px;border:1px solid #ffb0b0;border-radius:6px;font:bold 13px Arial;cursor:pointer}.topbar>.sale-review-bell{position:static;flex:0 0 auto;align-self:center;white-space:nowrap;min-height:32px;margin:0 6px;padding:6px 10px}`;document.head.appendChild(style);
  style.textContent+='.sale-review-panel{border:1px solid #ccd7e5;border-top:5px solid #e6a31a;border-radius:12px;padding:26px;font-size:16px;color:#172b49}.sale-review-panel h2{font-size:27px;color:#172b49;margin-bottom:12px}.sale-review-panel button{font-size:14px;padding:10px 14px;margin:8px 8px 0 0;min-height:38px}.sale-review-panel button.primary{background:#0767ce;border-color:#0767ce}.review-summary{background:#edf5ff;padding:14px;border-radius:8px;line-height:1.8}.review-different{background:#fff2cf}.review-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:16px}.sale-review-panel details{margin-top:16px;color:#65758d}.sale-review-panel input{padding:9px;border:1px solid #bbcbe0;border-radius:5px;margin:5px;max-width:100%}#recoveryAlert{width:min(900px,94vw);max-height:88vh;overflow:auto;background:white;color:#172b49;border:1px solid #ccd7e5;border-top:5px solid #e6a31a;border-radius:12px;padding:22px;box-shadow:0 10px 40px #0004}#recoveryAlert strong{font-size:25px}#recoveryAlert button{min-height:38px;border:1px solid #b8cce3;border-radius:5px;background:#f4f8ff;color:#174574}#recoveryAlert table{border-collapse:collapse;width:100%;margin-top:14px}#recoveryAlert th,#recoveryAlert td{border:1px solid #d8e3ef;padding:10px;text-align:left}#recoveryAlert details{margin-top:15px;color:#64748b}';
  style.textContent+='@media print{.sale-review-overlay,.sale-review-bell{display:none!important}}';
  function panel(title){const overlay=document.createElement('div');overlay.className='sale-review-overlay';overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-modal','true');const box=document.createElement('div');box.className='sale-review-panel';box.innerHTML=`<h2>${escape(title)}</h2>`;overlay.appendChild(box);document.body.appendChild(overlay);return{overlay,box};}
  async function post(entry){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const response=await fetch('/api/facturacion/revision-venta',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({idRevision:entry.id,comprobante:entry.data,motivo:entry.reason,url:entry.url})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo guardar la revisión central.');return result;}finally{clearTimeout(timer)}}
  async function flush(){if(flushBusy)return;flushBusy=true;try{const rows=read(KEY);for(const entry of Object.values(rows)){if(entry.central)continue;try{await post(entry);const current=read(KEY);if(current[entry.id]){current[entry.id].central=true;localStorage.setItem(KEY,JSON.stringify(current));}}catch{break}}}finally{flushBusy=false}}
  function hasSaleDetails(data){return Array.isArray(data?.articulos)&&data.articulos.some(row=>String(row.idart||'').trim()&&Number(row.cantidad)>0);}
  async function queue(data,reason){
    if(!hasSaleDetails(data))throw new Error('El borrador está vacío. No se envió como venta pendiente de revisión.');
    if(!adapters)throw new Error('No está listo el envío de revisiones. Conservá esta pantalla abierta.');
    if(data.revisionPendiente&&typeof data.revisionPendiente==='string')return;
    const sale=structuredClone(data);sale.emision=null;sale.revisionPendiente=true;
    const entry={id:adapters.newId(),data:sale,reason:String(reason||'Emisión pendiente de verificar en ARCA y SQL.'),url:location.origin+'/gestion.html',central:false};entry.url+='?revision='+encodeURIComponent(entry.id);
    const rows=read(KEY);rows[entry.id]=entry;localStorage.setItem(KEY,JSON.stringify(rows));
    try{await post(entry);entry.central=true;const current=read(KEY);current[entry.id]=entry;localStorage.setItem(KEY,JSON.stringify(current));}catch(error){console.warn('Aviso conservado para reenviar:',error);}
    await adapters.archive?.(sale,entry);
  }
  async function handle(data,error){
    if(!adapters||busy||!hasSaleDetails(data))return false;busy=true;
    const sale=structuredClone(data);sale.emision=null;sale.revisionPendiente=true;
    const entry={id:adapters.newId(),data:sale,reason:String(error.message||error),url:location.origin+'/gestion.html',central:false};entry.url+='?revision='+encodeURIComponent(entry.id);
    const ui=panel('NO SE PUDO CONFIRMAR ESTA VENTA');
    ui.box.insertAdjacentHTML('beforeend',`<p>Se conserva el detalle para revisión. <strong>No vuelvas a emitir esta venta.</strong></p><p data-status>Guardando la venta…</p>`);
    const status=ui.box.querySelector('[data-status]');
    let localSaved=false;
    try{const rows=read(KEY);rows[entry.id]=entry;localStorage.setItem(KEY,JSON.stringify(rows));localSaved=true;}catch{}
    try{await post(entry);entry.central=true;const rows=read(KEY);rows[entry.id]=entry;try{localStorage.setItem(KEY,JSON.stringify(rows))}catch{}}catch(e){if(!localSaved){status.textContent='No se pudo conservar la venta. Dejá esta pantalla abierta y avisá al encargado. '+e.message;busy=false;return false;}}
    try{await adapters.archive?.(sale,entry)}catch(e){console.warn('La revisión se conserva en el servidor o la copia de revisión local:',e)}
    status.textContent=entry.central?'Venta enviada a revisión para los administradores. Enviando el ticket pendiente…':'Venta conservada en esta PC. El aviso a los administradores se enviará cuando vuelva la conexión. Preparando el ticket pendiente…';
    try{await adapters.print(sale,entry);status.textContent=(entry.central?'Venta enviada a revisión para los administradores. ':'Venta conservada; aviso pendiente de conexión. ')+(adapters.browserPending()?'Ticket abierto en el selector de impresión. Confirmá ahí la impresión.':'Ticket pendiente enviado a la impresora.');}
    catch(e){status.textContent='La venta quedó conservada para revisión, pero NO se pudo enviar el ticket. Error de impresión: probá otra impresora o reiniciá la cola de impresión de esta PC. Detalle: '+e.message;const retry=document.createElement('button');retry.textContent='Reintentar ticket pendiente';retry.onclick=async()=>{retry.disabled=true;try{await adapters.print(sale,entry);status.textContent=adapters.browserPending()?'Ticket abierto en el selector de impresión.':'Ticket pendiente enviado a la impresora.';}catch(error){status.textContent='Error de impresión. Probá otra impresora o reiniciá la cola de impresión. Detalle: '+error.message}finally{retry.disabled=false}};ui.box.appendChild(retry);const help=document.createElement('button');help.textContent='Error de impresión · Elegir otra o reiniciar cola';help.onclick=()=>window.CorralonPrinterHelp?.show(e,{confirmed:false});ui.box.appendChild(help);}
    const next=document.createElement('button');next.className='primary';next.textContent='La venta quedó en revisión · Nueva venta';next.onclick=()=>{ui.overlay.remove();busy=false;adapters.next();};ui.box.appendChild(next);next.focus();return true;
  }

  async function requestReview(id,action,extra={}){
    if(!isBenja())throw new Error('Esta acción requiere una cuenta de administrador.');
    const response=await fetch('/api/facturacion/revision-venta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idRevision:id,accion:action,usuarioId:user().id||user().usuario,...extra})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo guardar la resolución.');return result;
  }
  function openReviewTab(id,type=null){const url=new URL('/gestion.html',location.origin);url.searchParams.set('revisionBorrador',id);if(type!==null)url.searchParams.set('continuarRevision',String(type));url.hash='facturacion';window.open(url.href,'_blank','noopener');}
  function dateLabel(value){const text=String(value||'').replace(/-/g,'');return /^\d{8}$/.test(text)?text.slice(6,8)+'/'+text.slice(4,6)+'/'+text.slice(0,4):String(value||'—');}
  function statusView(container,state,options={}){
    const mismatch=state.estado==='diferente',safe=['noautorizado','reintentable'].includes(state.estado);
    const arca={autorizado:'Autorizado con datos coincidentes',datosDistintos:'Número autorizado con otros datos',noRegistrado:'No registra ese comprobante',noRequiere:'No requiere CAE'}[state.arca]||'Sin resultado confirmado';
    const sql=state.estado==='emitido'?'Comprobante confirmado':state.sql==='pendiente'?'Registro pendiente, sin confirmar':'Este borrador no figura confirmado';
    container.innerHTML='<div class="review-summary"><div><b>ARCA:</b> '+escape(arca)+'</div><div><b>SQL:</b> '+escape(sql)+'</div></div>';
    if(mismatch){const local=state.borrador||{},actual=state.autorizado||{};container.insertAdjacentHTML('beforeend','<p><b>Los datos autorizados no coinciden con este borrador.</b></p><table><thead><tr><th>Dato</th><th>Este borrador</th><th>Autorizado en ARCA</th></tr></thead><tbody>'+[['Documento',local.documento,actual.documento],['Importe',money(local.total),money(actual.total)],['Fecha',dateLabel(local.fecha),dateLabel(actual.fecha)]].map(([label,a,b])=>'<tr><th>'+escape(label)+'</th><td class="'+(String(a)!==String(b)?'review-different':'')+'">'+escape(a)+'</td><td>'+escape(b)+'</td></tr>').join('')+'</tbody></table>');}
    else container.insertAdjacentHTML('beforeend','<p>'+escape(state.detalle||(safe?'Podés corregir el documento y continuar con los mismos artículos y pagos.':state.estado==='recuperable'?'Falta completar el guardado en SQL. Recuperá la misma emisión.':'Verificá el intento anterior antes de emitir otra venta.'))+'</p>');
    if(state.numero)container.insertAdjacentHTML('beforeend','<p><small>Comprobante consultado: '+escape(state.numero)+'</small></p>');
    const actions=document.createElement('div');actions.className='review-actions';container.appendChild(actions);
    function action(label,handler,primary=false){const b=document.createElement('button');b.type='button';b.textContent=label;if(primary)b.className='primary';b.onclick=async()=>{b.disabled=true;try{await handler();}catch(error){const note=document.createElement('p');note.textContent=error.message;container.appendChild(note);}finally{b.disabled=false;}};actions.appendChild(b);}
    if(options.onFind)action('Buscar venta realizada',options.onFind,!safe);
    if(safe&&options.onPrepare){action('Corregir y emitir',()=>options.onPrepare(Number(options.sale.idComprobante)),true);action('Continuar como presupuesto',()=>options.onPrepare(43));action('Continuar como X-venta',()=>options.onPrepare(13));}
    if(options.onRefresh)action('Consultar de nuevo',options.onRefresh);
    if(options.onLater)action('Revisar después',options.onLater);
    container.insertAdjacentHTML('beforeend','<details><summary>Ver detalle técnico</summary><p>'+escape(state.detalle||'Consulta completada sin modificar la venta.')+'</p></details>');
  }
  async function findCompletedSale(id,sale,onResolved){
    if(!window.CorralonInvoiceHistory?.selectForReview)throw new Error('La consulta de Facturación todavía está cargando.');
    await window.CorralonInvoiceHistory.selectForReview({sale,onSelect:async detail=>{
      const h=detail.comprobante;await requestReview(id,'resolver',{idRecibo:h.idRecibo||detail.idRecibo});await onResolved?.(h);
    }});
  }
  async function showNotification(item){
    if(!isBenja()||!inBilling())return;
    const seen=read(SEEN);seen[item.id]=true;localStorage.setItem(SEEN,JSON.stringify(seen));
    const ui=panel('Esta venta necesita revisión');ui.overlay.dataset.saleReviewAdmin='1';
    ui.box.insertAdjacentHTML('beforeend',`<p><strong>${escape(item.cliente||'Sin cliente')}</strong> · ${escape(money(item.total))}</p><p>${escape(item.usuario||'Vendedor')} · ${escape(item.fecha||'')}</p><details><summary>Motivo original</summary><p>${escape(item.motivo)}</p></details><div data-detail></div>`);
    const open=document.createElement('button');open.textContent='Ver artículos y pagos';open.onclick=()=>{const url=new URL('/gestion.html',location.origin);url.searchParams.set('revisionBorrador',item.id);url.hash='facturacion';window.open(url.href,'_blank','noopener');};ui.box.appendChild(open);
    const verify=document.createElement('button');verify.textContent='Consultar ARCA y SQL';
    verify.onclick=async()=>{verify.disabled=true;const detail=ui.box.querySelector('[data-detail]');detail.textContent='Consultando SQL y el estado fiscal de esta venta…';try{
      const reviewResponse=await fetch('/api/facturacion/revision-venta?id='+encodeURIComponent(item.id),{cache:'no-store'});
      const review=await reviewResponse.json();if(!reviewResponse.ok||!review.ok)throw new Error(review.error||'No se pudo leer la revisión.');
      const sale=review.revision.comprobante;
      const response=await fetch('/api/facturacion/estado-emision?'+new URLSearchParams({id:sale.id,tipo:sale.idComprobante,consultarArca:'1'}),{cache:'no-store'});
      const state=await response.json();if(!response.ok||!state.ok)throw new Error(state.error||'No se pudo verificar la emisión.');
      statusView(detail,state,{sale,onFind:()=>findCompletedSale(item.id,sale,()=>ui.overlay.remove()),onPrepare:type=>openReviewTab(item.id,type),onRefresh:()=>verify.onclick(),onLater:()=>ui.overlay.remove()});
    }catch(error){detail.textContent='No se pudo verificar: '+error.message;}finally{verify.disabled=false;}};ui.box.appendChild(verify);
    const find=document.createElement('button');find.textContent='Buscar venta realizada';find.onclick=async()=>{find.disabled=true;try{const r=await fetch('/api/facturacion/revision-venta?id='+encodeURIComponent(item.id),{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'No se pudo abrir la revisión.');await findCompletedSale(item.id,d.revision.comprobante,()=>ui.overlay.remove());}catch(error){ui.box.querySelector('[data-detail]').textContent=error.message;}finally{find.disabled=false;}};ui.box.appendChild(find);
    const reviewed=document.createElement('button');reviewed.textContent='Revisado';reviewed.title='Cerrar este pendiente sin modificar la venta en SQL';reviewed.onclick=async()=>{reviewed.disabled=true;try{const result=await requestReview(item.id,'revisado');notifications=notifications.filter(row=>row.id!==item.id&&(!result.borradorId||row.borradorId!==result.borradorId));localPendingDrafts=localPendingDrafts.filter(row=>row.id!==result.borradorId&&row.revisionPendiente!==item.id);ui.overlay.remove();renderNotifications();}catch(error){ui.box.querySelector('[data-detail]').textContent=error.message;reviewed.disabled=false;}};ui.box.appendChild(reviewed);
    const later=document.createElement('button');later.textContent='Revisar después';later.onclick=()=>ui.overlay.remove();ui.box.appendChild(later);
  }
  function pendingEntries(){
    const items=new Map();for(const item of notifications){const key=item.borradorId||item.id;if(!items.has(key))items.set(key,{remote:item});}
    for(const draft of localPendingDrafts){const remote=notifications.find(item=>item.borradorId===draft.id||item.id===draft.revisionPendiente);if(remote)continue;if(!items.has(draft.id))items.set(draft.id,{local:draft});}
    return [...items.values()];
  }
  function showPendingList(){
    if(!isBenja()||!inBilling())return;
    const ui=panel('Ventas pendientes');ui.overlay.dataset.saleReviewAdmin='1';
    const items=pendingEntries();if(!items.length)ui.box.insertAdjacentHTML('beforeend','<p>No hay ventas pendientes.</p>');
    for(const item of items){const b=document.createElement('button');const data=item.remote||item.local;b.textContent=(item.remote?data.cliente:data.cliente?.nombre||'Sin cliente')+' · '+money(item.remote?data.total:data.totales?.total)+' · '+(data.usuario||'')+' · '+(data.fecha||'');b.style.display='block';b.style.width='100%';b.style.textAlign='left';b.onclick=async()=>{b.disabled=true;try{if(item.remote){ui.overlay.remove();await showNotification(item.remote);}else{await adapters?.openLocal?.(item.local.id);ui.overlay.remove();}}catch(error){const p=document.createElement('p');p.textContent=error.message;ui.box.appendChild(p);}finally{b.disabled=false;}};ui.box.appendChild(b);}
    const close=document.createElement('button');close.textContent='Cerrar';close.onclick=()=>ui.overlay.remove();ui.box.appendChild(close);
  }
  function renderNotifications(){
    const shared=document.getElementById('openDrafts');if(shared&&isBenja()){document.getElementById('saleReviewGlobalBell')?.remove();const count=pendingEntries().length;shared.hidden=!inBilling()||count===0;shared.textContent='Pendientes ('+count+')';if(!inBilling())document.querySelectorAll('[data-sale-review-admin]').forEach(el=>el.remove());return;}
    let bell=document.getElementById('saleReviewGlobalBell');if(!notifications.length||!isBenja()||!inBilling()){bell?.remove();document.querySelectorAll('[data-sale-review-admin]').forEach(el=>el.remove());return;}
    if(!bell){bell=document.createElement('button');bell.id='saleReviewGlobalBell';bell.className='sale-review-bell';bell.onclick=()=>showPendingList();const navigation=document.querySelector('main.app>.topbar .sale-navigation');if(navigation)navigation.before(bell);else document.body.appendChild(bell);}bell.textContent=`Ventas en revisión (${notifications.length})`;
    const requested=new URLSearchParams(location.search).get('revision'),requestedItem=notifications.find(item=>item.id===requested);if(requestedItem&&!requestedOpened){requestedOpened=true;showNotification(requestedItem);return;}
    // Las revisiones se abren desde el botón, sin interrumpir cada pantalla.
  }
  async function listen(){
    if(!isBenja()||!inBilling()){unsubscribe?.();unsubscribe=null;notifications=[];document.querySelectorAll('[data-sale-review-admin]').forEach(el=>el.remove());renderNotifications();return;}
    if(unsubscribe||starting)return;starting=true;
    try{const [app,f]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')]);
      if(!isBenja()||!inBilling())return;const config={apiKey:'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',projectId:'corralon-progreso',appId:'1:466583614632:web:42cb839f83e97475fabe9d'};
      const named=app.getApps().find(a=>a.name==='sale-reviews')||app.initializeApp(config,'sale-reviews'),db=f.getFirestore(named);firebaseTools={...f,db};
      unsubscribe=f.onSnapshot(f.query(f.collection(db,'facturacionRevisiones'),f.where('estado','==','pendiente')),snapshot=>{notifications=snapshot.docs.map(d=>({...d.data(),id:d.id}));renderNotifications();},error=>console.warn('No se pudieron recibir revisiones de ventas:',error));
    }catch(e){console.warn('No se pudo iniciar el aviso de revisiones:',e)}finally{starting=false}
  }
  window.CorralonSaleReviews={configure:options=>{adapters=options;flush();},handle,queue,isBenja,statusView,requestReview,findCompletedSale,showPendingList,setLocalDrafts:drafts=>{localPendingDrafts=drafts;renderNotifications();}};
  window.dispatchEvent(new Event('corralon-sale-reviews-ready'));
  window.addEventListener('online',()=>{flush();listen()});window.addEventListener('storage',()=>{listen();renderNotifications()});
  window.addEventListener('hashchange',()=>{listen();renderNotifications()});
  if(typeof MutationObserver!=='undefined')new MutationObserver(()=>{listen();renderNotifications()}).observe(document.body,{attributes:true,attributeFilter:['data-system-section']});
  setInterval(()=>{if(adapters)flush();},60000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',listen,{once:true});else listen();
})();
