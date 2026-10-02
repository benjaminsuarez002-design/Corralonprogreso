(function(){
  if(window.CorralonSaleReviews)return;
  const KEY='corralon_ventas_revision_v1',SEEN='corralon_ventas_revision_vistas_v1';
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(v)||0);
  const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return{}}};
  const user=()=>read('corralon_menu_active_user_snapshot_v1');
  const isBenja=()=>[user().usuario,user().id].some(v=>String(v||'').trim().toLowerCase()==='benja');
  let requestedOpened=false,adapters=null,busy=false,unsubscribe=null,starting=false,notifications=[],firebaseTools=null,flushBusy=false;
  const style=document.createElement('style');style.textContent=`.sale-review-overlay{position:fixed;inset:0;z-index:2147483000;background:#000b;display:flex;align-items:center;justify-content:center;padding:24px}.sale-review-panel{background:white;color:#151515;border:8px solid #e00000;border-radius:18px;padding:28px;width:min(920px,94vw);max-height:90vh;overflow:auto;font:18px Arial}.sale-review-panel h2{color:#d00000;font-size:clamp(30px,4vw,52px);margin:0 0 20px}.sale-review-panel p{line-height:1.4}.sale-review-panel button,.sale-review-panel a{display:inline-block;font:bold 18px Arial;padding:14px;margin:8px;border:1px solid #bbb;border-radius:8px;cursor:pointer}.sale-review-panel button.primary{background:#df0000;color:white}.sale-review-panel table{border-collapse:collapse;width:100%;font-size:15px}.sale-review-panel td,.sale-review-panel th{border:1px solid #ddd;padding:7px}.sale-review-bell{position:fixed;right:16px;bottom:16px;z-index:2147482999;background:#d00000;color:white;padding:16px;border:0;border-radius:12px;font:bold 17px Arial;cursor:pointer}`;document.head.appendChild(style);
  style.textContent+='@media print{.sale-review-overlay,.sale-review-bell{display:none!important}}';
  function panel(title){const overlay=document.createElement('div');overlay.className='sale-review-overlay';overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-modal','true');const box=document.createElement('div');box.className='sale-review-panel';box.innerHTML=`<h2>${escape(title)}</h2>`;overlay.appendChild(box);document.body.appendChild(overlay);return{overlay,box};}
  async function post(entry){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const response=await fetch('/api/facturacion/revision-venta',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({idRevision:entry.id,comprobante:entry.data,motivo:entry.reason,url:entry.url})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo guardar la revisión central.');return result;}finally{clearTimeout(timer)}}
  async function flush(){if(flushBusy)return;flushBusy=true;try{const rows=read(KEY);for(const entry of Object.values(rows)){if(entry.central)continue;try{await post(entry);const current=read(KEY);if(current[entry.id]){current[entry.id].central=true;localStorage.setItem(KEY,JSON.stringify(current));}}catch{break}}}finally{flushBusy=false}}
  async function handle(data,error){
    if(!adapters||busy)return false;busy=true;
    const sale=structuredClone(data);sale.emision=null;sale.revisionPendiente=true;
    const entry={id:adapters.newId(),data:sale,reason:String(error.message||error),url:location.origin+'/facturacion.html',central:false};entry.url+='?revision='+encodeURIComponent(entry.id);
    const ui=panel('NO SE PUDO CONFIRMAR ESTA VENTA');
    ui.box.insertAdjacentHTML('beforeend',`<p>Se conserva el detalle para revisión. <strong>No vuelvas a emitir esta venta.</strong></p><p data-status>Guardando la venta…</p>`);
    const status=ui.box.querySelector('[data-status]');
    let localSaved=false;
    try{const rows=read(KEY);rows[entry.id]=entry;localStorage.setItem(KEY,JSON.stringify(rows));localSaved=true;}catch{}
    try{await post(entry);entry.central=true;const rows=read(KEY);rows[entry.id]=entry;try{localStorage.setItem(KEY,JSON.stringify(rows))}catch{}}catch(e){if(!localSaved){status.textContent='No se pudo conservar la venta. Dejá esta pantalla abierta y avisá al encargado. '+e.message;busy=false;return false;}}
    try{await adapters.archive?.(sale,entry)}catch(e){console.warn('La revisión se conserva en el servidor o la copia de revisión local:',e)}
    status.textContent=entry.central?'Venta enviada a revisión para benja. Enviando el ticket pendiente…':'Venta conservada en esta PC. El aviso a benja se enviará cuando vuelva la conexión. Preparando el ticket pendiente…';
    try{await adapters.print(sale,entry);status.textContent=(entry.central?'Venta enviada a revisión para benja. ':'Venta conservada; aviso pendiente de conexión. ')+(adapters.browserPending()?'Ticket abierto en el selector de impresión. Confirmá ahí la impresión.':'Ticket pendiente enviado a la impresora.');}
    catch(e){status.textContent='La venta quedó conservada para revisión, pero NO se pudo enviar el ticket: '+e.message;const retry=document.createElement('button');retry.textContent='Reintentar ticket pendiente';retry.onclick=async()=>{retry.disabled=true;try{await adapters.print(sale,entry);status.textContent=adapters.browserPending()?'Ticket abierto en el selector de impresión.':'Ticket pendiente enviado a la impresora.';}catch(error){status.textContent='No se pudo imprimir: '+error.message}finally{retry.disabled=false}};ui.box.appendChild(retry);}
    const next=document.createElement('button');next.className='primary';next.textContent='La venta quedó en revisión · Nueva venta';next.onclick=()=>{ui.overlay.remove();busy=false;adapters.next();};ui.box.appendChild(next);next.focus();return true;
  }
  async function showNotification(item){
    if(!isBenja())return;
    const seen=read(SEEN);seen[item.id]=true;localStorage.setItem(SEEN,JSON.stringify(seen));
    const ui=panel('VENTA PENDIENTE DE REVISIÓN');ui.overlay.dataset.saleReviewAdmin='1';
    ui.box.insertAdjacentHTML('beforeend',`<p><strong>${escape(item.cliente||'Sin cliente')}</strong> · ${escape(money(item.total))}</p><p>${escape(item.usuario||'Vendedor')} · ${escape(item.fecha||'')}</p><p>${escape(item.motivo)}</p><div data-detail></div>`);
    const open=document.createElement('button');open.textContent='Ver artículos y pagos';open.onclick=async()=>{open.disabled=true;try{const url=new URL(item.url||location.href);if(!['http:','https:'].includes(url.protocol))throw new Error('Dirección inválida');if(url.origin!==location.origin){window.open(url.href,'_blank','noopener');return;}const r=await fetch('/api/facturacion/revision-venta?id='+encodeURIComponent(item.id));const result=await r.json();if(!r.ok||!result.ok)throw new Error(result.error);const d=result.revision.comprobante;ui.box.querySelector('[data-detail]').innerHTML=`<table><thead><tr><th>IDArt</th><th>Artículo</th><th>Cantidad</th><th>Precio</th></tr></thead><tbody>${d.articulos.map(row=>`<tr><td>${escape(row.idart)}</td><td>${escape(row.descripcion)}</td><td>${escape(row.cantidad)}</td><td>${escape(money(row.precio))}</td></tr>`).join('')}</tbody></table><p>Pagos: ${d.valores.map(v=>escape(v.tipo)+': '+escape(money(Number(v.importe)+Number(v.impRec||0)))).join(' · ')}</p><p>Esta revisión no confirma ventas ni modifica SQL.</p>`;}catch(e){ui.box.querySelector('[data-detail]').textContent=e.message;}finally{open.disabled=false}};ui.box.appendChild(open);
    const resolve=document.createElement('button');resolve.textContent='Marcar revisado';resolve.onclick=async()=>{resolve.disabled=true;try{if(!isBenja())throw new Error('Iniciá sesión como benja');await firebaseTools.updateDoc(firebaseTools.doc(firebaseTools.db,'facturacionRevisiones',item.id),{estado:'revisado',revisadoAt:firebaseTools.serverTimestamp()});ui.overlay.remove();}catch(e){resolve.disabled=false;ui.box.querySelector('[data-detail]').textContent=e.message;}};ui.box.appendChild(resolve);
    const later=document.createElement('button');later.textContent='Revisar después';later.onclick=()=>ui.overlay.remove();ui.box.appendChild(later);
  }
  function renderNotifications(){
    let bell=document.getElementById('saleReviewGlobalBell');if(!notifications.length||!isBenja()){bell?.remove();return;}
    if(!bell){bell=document.createElement('button');bell.id='saleReviewGlobalBell';bell.className='sale-review-bell';bell.onclick=()=>showNotification(notifications[0]);document.body.appendChild(bell);}bell.textContent=`Ventas en revisión (${notifications.length})`;
    const requested=new URLSearchParams(location.search).get('revision'),requestedItem=notifications.find(item=>item.id===requested);if(requestedItem&&!requestedOpened){requestedOpened=true;showNotification(requestedItem);return;}
    const seen=read(SEEN),fresh=notifications.find(item=>!seen[item.id]);if(fresh&&!document.querySelector('[data-sale-review-admin]'))showNotification(fresh);
  }
  async function listen(){
    if(!isBenja()){unsubscribe?.();unsubscribe=null;notifications=[];document.querySelectorAll('[data-sale-review-admin]').forEach(el=>el.remove());renderNotifications();return;}
    if(unsubscribe||starting)return;starting=true;
    try{const [app,f]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')]);
      if(!isBenja())return;const config={apiKey:'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',projectId:'corralon-progreso',appId:'1:466583614632:web:42cb839f83e97475fabe9d'};
      const named=app.getApps().find(a=>a.name==='sale-reviews')||app.initializeApp(config,'sale-reviews'),db=f.getFirestore(named);firebaseTools={...f,db};
      unsubscribe=f.onSnapshot(f.query(f.collection(db,'facturacionRevisiones'),f.where('destinatario','==','benja'),f.where('estado','==','pendiente')),snapshot=>{notifications=snapshot.docs.map(d=>({...d.data(),id:d.id}));renderNotifications();},error=>console.warn('No se pudieron recibir revisiones de ventas:',error));
    }catch(e){console.warn('No se pudo iniciar el aviso de revisiones:',e)}finally{starting=false}
  }
  window.CorralonSaleReviews={configure:options=>{adapters=options;flush();},handle,isBenja};
  window.dispatchEvent(new Event('corralon-sale-reviews-ready'));
  window.addEventListener('online',()=>{flush();listen()});window.addEventListener('storage',()=>{listen();renderNotifications()});
  setInterval(listen,4000);setInterval(()=>{if(adapters)flush();},60000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',listen,{once:true});else listen();
})();
