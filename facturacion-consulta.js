(function(){
  const button=document.getElementById('consultInvoices');if(!button)return;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(value)||0);
  const number=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:4}).format(Number(value)||0);
  const styles=document.createElement('style');styles.textContent=`
    .invoice-history-overlay{position:fixed;inset:0;z-index:95;background:#0009;display:grid;place-items:center;padding:16px}
    .invoice-history-overlay[hidden]{display:none}.invoice-history-card{background:#fff;border-radius:12px;width:min(1200px,100%);height:min(850px,92dvh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 55px #0005;color:#151515;font:14px Barlow,Arial,sans-serif}
    .invoice-history-head{padding:12px 16px;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.invoice-history-head h2{margin:0;flex:1;font-size:22px}.invoice-history-card button{cursor:pointer;border:1px solid #bbb;border-radius:7px;background:#fff;padding:7px 12px;font:700 14px Barlow,Arial,sans-serif}.invoice-history-card button:disabled{opacity:.45;cursor:default}.invoice-history-card button.primary{background:#ed1019;color:#fff;border-color:#ed1019}
    .invoice-history-filters{padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid #ddd;align-items:end}.invoice-history-filters label{display:grid;gap:4px;font-weight:700}.invoice-history-filters input,.invoice-history-filters select{height:33px;padding:4px 7px;border:1px solid #bbb;border-radius:5px;font:14px Barlow,Arial,sans-serif;max-width:100%}.invoice-history-filters input.date{width:130px}.invoice-history-filters .search{flex:1;min-width:180px}.invoice-history-status{padding:8px 16px;color:#666;min-height:30px}.invoice-history-status.error{color:#b00020}
    .invoice-history-scroll{flex:1;min-height:0;overflow:auto;padding:0 16px}.invoice-history-table{width:100%;border-collapse:collapse;font-size:14px}.invoice-history-table th{position:sticky;top:0;background:#eee;text-align:left;z-index:1}.invoice-history-table th,.invoice-history-table td{padding:9px 8px;border-bottom:1px solid #ddd}.invoice-history-table tbody tr:nth-child(even){background:#f6f6f6}.invoice-history-table tbody tr[data-invoice]{cursor:pointer}.invoice-history-table tbody tr[data-invoice]:hover{background:#ffe8e9}.invoice-history-table .money{text-align:right;white-space:nowrap}.invoice-history-table .cancelled{color:#b00020}.invoice-history-footer{padding:10px 16px;border-top:1px solid #ddd;display:flex;align-items:center;justify-content:space-between;gap:10px}.invoice-history-detail-summary{padding:12px 0;display:flex;gap:12px;flex-wrap:wrap}.invoice-history-detail-summary strong{display:block}.invoice-history-detail-summary>div{min-width:125px}.invoice-history-detail h3{margin:16px 0 8px}.invoice-history-detail-total{font-size:20px;font-weight:800;text-align:right;padding:12px 0}
    @media(max-width:650px){.invoice-history-overlay{padding:0}.invoice-history-card{width:100%;height:100dvh;border-radius:0}.invoice-history-filters{gap:6px;padding:8px}.invoice-history-scroll{padding:0 8px}.invoice-history-filters label{flex:1;min-width:120px}.invoice-history-filters input.date{width:100%}.invoice-history-table{font-size:12px}.invoice-history-table th,.invoice-history-table td{padding:7px 5px}}
    @media print{.invoice-history-overlay{display:none!important}}
  `;document.head.appendChild(styles);
  const overlay=document.createElement('div');overlay.className='invoice-history-overlay';overlay.hidden=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Consultar boletas');
  overlay.innerHTML=`<section class="invoice-history-card"><header class="invoice-history-head"><h2>Consultar boletas</h2><button data-close type="button">Cerrar</button></header><form class="invoice-history-filters"><label>Sucursal<select data-branch><option value="0">Todas las sucursales</option></select></label><label>Punto de venta<select data-point><option value="0">Todos los puntos de venta</option></select></label><label>Desde<input class="date" data-from inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" required></label><label>Hasta<input class="date" data-to inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" required></label><label class="search">Cliente o número<input data-search autocomplete="off" placeholder="Buscar cliente o boleta…" maxlength="80"></label><button class="primary" type="submit">Consultar</button></form><div class="invoice-history-status" data-status role="status" aria-live="polite"></div><div class="invoice-history-scroll"><table class="invoice-history-table"><thead><tr><th>Número</th><th>Tipo</th><th>Cliente</th><th>Sucursal</th><th>Fecha</th><th class="money">Total</th><th>Estado</th><th></th></tr></thead><tbody data-rows></tbody></table></div><footer class="invoice-history-footer"><span data-position></span><div><button data-prev type="button">‹ Anterior</button> <button data-next type="button">Siguiente ›</button></div></footer></section>`;document.body.appendChild(overlay);
  const get=selector=>overlay.querySelector(selector),status=get('[data-status]');
  const detail=document.createElement('div');detail.className='invoice-history-overlay';detail.hidden=true;detail.style.zIndex='96';detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');detail.setAttribute('aria-label','Detalle de boleta');
  detail.innerHTML=`<section class="invoice-history-card"><header class="invoice-history-head"><h2 data-title>Boleta</h2><button data-detail-prev type="button" aria-label="Boleta anterior">‹</button><span data-detail-position></span><button data-detail-next type="button" aria-label="Boleta siguiente">›</button><button data-detail-close type="button">Cerrar</button></header><div class="invoice-history-scroll invoice-history-detail" data-detail-body></div><footer class="invoice-history-footer"><span data-action-status role="status"></span><div><button data-reprint type="button" disabled>Reimprimir</button> <button data-recall class="primary" type="button" disabled>Llamar a facturar</button></div></footer></section>`;document.body.appendChild(detail);
  let rows=[],page=0,hasMore=false,listController=null,detailController=null,sequence=0,detailSequence=0,detailIndex=-1,searchTimer=null,actionBusy=false,detailData=null;
  const warrantyMenu=document.createElement('div');warrantyMenu.hidden=true;
  warrantyMenu.style.cssText='position:fixed;z-index:98;padding:4px;background:var(--corralon-white,#fff);border:1px solid var(--corralon-line-strong,#bbb);border-radius:7px;box-shadow:0 5px 18px #0003';
  warrantyMenu.innerHTML='<button type="button" style="padding:9px 14px;border:0;background:var(--corralon-white,#fff);color:var(--corralon-text,#222);font:700 14px Barlow,Arial;cursor:pointer">Generar garantía</button>';
  document.body.appendChild(warrantyMenu);
  let warrantyArticleIndex=-1,warrantyBridge=null;
  function loadWarrantyBridge(){
    if(warrantyBridge)return warrantyBridge;
    const frame=document.createElement('iframe');frame.hidden=true;frame.title='Generador de garantías';
    warrantyBridge=new Promise((resolve,reject)=>{
      let observer;
      const timer=setTimeout(()=>{observer?.disconnect();reject(new Error('No se pudo cargar Garantías. Revisá la conexión y los permisos de usuario.'));},20000);
      const ready=()=>{
        try{
          const generator=frame.contentWindow.CorralonGarantiaDesdeFacturacion;
          if(typeof generator!=='function'||frame.contentDocument.documentElement.style.visibility==='hidden')return;
          clearTimeout(timer);observer?.disconnect();resolve(generator);
        }catch(error){clearTimeout(timer);reject(error);}
      };
      frame.onload=()=>{
        try{
          observer=new MutationObserver(ready);
          observer.observe(frame.contentDocument.documentElement,{attributes:true,attributeFilter:['style']});
          frame.contentWindow.addEventListener('menu-user-validated',ready);ready();
        }
        catch(error){clearTimeout(timer);reject(error);}
      };
      frame.onerror=()=>{clearTimeout(timer);reject(new Error('No se pudo cargar el generador de garantías.'));};
      frame.src='garant%C3%ADas.html?desdeFacturacion=1';document.body.appendChild(frame);
    }).catch(error=>{frame.remove();warrantyBridge=null;throw error;});
    return warrantyBridge;
  }
  detail.addEventListener('contextmenu',event=>{
    const line=event.target.closest('[data-warranty-article]');
    if(!line||!detailData||actionBusy)return;
    event.preventDefault();warrantyArticleIndex=Number(line.dataset.warrantyArticle);
    const allowed=window.CorralonFunciones?.menuUserHasAccess('garantias');
    const confirmed=Number(detailData.comprobante.confirmado)&&!Number(detailData.comprobante.anulada);
    const action=warrantyMenu.querySelector('button');action.disabled=!allowed||!confirmed;
    action.title=!allowed?'Tu usuario no tiene permiso para Garantías':!confirmed?'La boleta debe estar confirmada y sin anular':'';
    warrantyMenu.hidden=false;
    warrantyMenu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-warrantyMenu.offsetWidth-8))+'px';
    warrantyMenu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-warrantyMenu.offsetHeight-8))+'px';
    action.focus();
  });
  warrantyMenu.querySelector('button').addEventListener('click',async()=>{
    const article=detailData?.articulos?.[warrantyArticleIndex],header=detailData?.comprobante,invoice=rows[detailIndex];
    warrantyMenu.hidden=true;
    if(!article||!header||!invoice||actionBusy||!window.CorralonFunciones?.menuUserHasAccess('garantias'))return;
    const payload={codigo:String(article.idart||''),descripcion:article.descripcion,cliente:String(header.cliente||invoice.cliente||'').toUpperCase(),boleta:invoice.numero,fechaIso:String(header.fechaComprobante||'').slice(0,10)};
    const pdfWindow=window.open('about:blank','_blank');
    if(pdfWindow){pdfWindow.document.title='Garantía';pdfWindow.document.body.textContent='Generando garantía…';pdfWindow.document.body.style.cssText='font:18px Arial;padding:24px';pdfWindow.opener=null;}
    let pdfShown=false,generationTimer;
    const showPdf=blob=>{
      if(pdfShown)return;
      const pdfUrl=URL.createObjectURL(blob);
      if(pdfWindow&&!pdfWindow.closed)pdfWindow.location.replace(pdfUrl);
      else{const link=document.createElement('a');link.href=pdfUrl;link.download=`Garantia-${payload.boleta}-${payload.codigo}.pdf`;document.body.appendChild(link);link.click();link.remove();}
      pdfShown=true;setTimeout(()=>URL.revokeObjectURL(pdfUrl),300000);
    };
    actionBusy=true;const notice=detail.querySelector('[data-action-status]');notice.textContent='Generando garantía y notificación…';
    detail.querySelectorAll('[data-reprint],[data-recall],[data-detail-prev],[data-detail-next]').forEach(control=>control.disabled=true);
    try{
      const generator=await loadWarrantyBridge();
      const result=await Promise.race([
        generator(payload,showPdf),
        new Promise((_,reject)=>{generationTimer=setTimeout(()=>reject(new Error(pdfShown?'El PDF está generado, pero el historial y la notificación siguen pendientes de respuesta.':'La generación del PDF no respondió. Reintentá desde Facturación.')),35000);})
      ]);
      if(!result?.blob)throw new Error('Garantías no devolvió el PDF.');
      showPdf(result.blob);
      notice.textContent=result.historial.existente?'PDF generado. La garantía ya estaba registrada; se conservó su notificación.':'Garantía generada y registrada en Notificaciones.';
    }catch(error){if(!pdfShown&&pdfWindow&&!pdfWindow.closed){pdfWindow.document.body.textContent=error.message;}notice.textContent=error.message;}
    finally{
      clearTimeout(generationTimer);
      actionBusy=false;
      if(!detail.hidden){const unavailable=!Number(header.confirmado)||Boolean(Number(header.anulada));detail.querySelector('[data-reprint]').disabled=unavailable;detail.querySelector('[data-recall]').disabled=unavailable;detail.querySelector('[data-detail-prev]').disabled=detailIndex===0;detail.querySelector('[data-detail-next]').disabled=detailIndex===rows.length-1;}
    }
  });
  document.addEventListener('pointerdown',event=>{if(!warrantyMenu.contains(event.target))warrantyMenu.hidden=true;});
  function dateText(date){return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()}`}
  function dateInput(field){
    const parsed=window.CorralonFunciones?.parseFechaFlexible(field.value);if(!parsed){field.setCustomValidity('Ingresá una fecha válida.');field.reportValidity();return null}
    field.setCustomValidity('');field.value=parsed.text;const d=parsed.date;return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  async function sql(path,controller){
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{const response=await fetch('/api/facturacion/'+path,{cache:'no-store',signal:controller.signal});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo consultar SQL.');return result}finally{clearTimeout(timeout)}
  }
  function message(text,error=false){status.textContent=text;status.classList.toggle('error',error)}
  function pager(){get('[data-prev]').disabled=page===0||!rows.length;get('[data-next]').disabled=!hasMore;get('[data-position]').textContent=`Página ${page+1} · ${rows.length} boletas`}
  async function load(targetPage=0){
    clearTimeout(searchTimer);const from=dateInput(get('[data-from]')),to=dateInput(get('[data-to]'));if(!from||!to)return;
    if(from>to){message('La fecha Desde debe ser anterior o igual a Hasta.',true);return}
    listController?.abort();const controller=listController=new AbortController(),request=++sequence;
    rows=[];get('[data-rows]').innerHTML='';get('[data-prev]').disabled=true;get('[data-next]').disabled=true;get('[data-position]').textContent='';message('Consultando boletas…');
    try{const params=new URLSearchParams({desde:from,hasta:to,sucursal:get('[data-branch]').value,puntoVenta:get('[data-point]').value,buscar:get('[data-search]').value.trim(),pagina:String(targetPage)});const result=await sql('consultar-comprobantes?'+params,controller);if(request!==sequence||overlay.hidden)return;
      page=result.pagina;hasMore=Boolean(result.hayMas);rows=result.comprobantes;
      get('[data-rows]').innerHTML=rows.map((r,i)=>`<tr data-invoice="${i}" tabindex="0" aria-label="Abrir boleta ${escape(r.numero)}"><td>${escape(r.numero)}</td><td>${escape(r.tipo)}</td><td>${escape(String(r.cliente||'').toUpperCase())}</td><td>${escape(r.sucursal||'Sin sucursal')}</td><td>${escape(r.fecha)}</td><td class="money">${escape(money(r.total))}</td><td class="${Number(r.anulada)?'cancelled':''}">${Number(r.anulada)?'Anulada':'Confirmada'}</td><td><button data-invoice="${i}" type="button">Abrir</button></td></tr>`).join('');
      message(rows.length?'Boletas consultadas en SQL.': 'No hay boletas para esos filtros.');pager();
    }catch(error){if(request===sequence&&!overlay.hidden){message(controller.signal.aborted?'La consulta no respondió a tiempo. Volvé a consultar.':error.message,true)}}
  }
  async function openDetail(index){
    const row=rows[index];if(!row||actionBusy)return;warrantyMenu.hidden=true;detailData=null;detailIndex=index;detail.querySelector('[data-reprint]').disabled=true;detail.querySelector('[data-recall]').disabled=true;detail.querySelector('[data-action-status]').textContent='';detail.hidden=false;detailController?.abort();const controller=detailController=new AbortController(),request=++detailSequence;
    detail.querySelector('[data-title]').textContent='Boleta '+row.numero;detail.querySelector('[data-detail-position]').textContent=`${index+1} de ${rows.length}`;detail.querySelector('[data-detail-prev]').disabled=index===0;detail.querySelector('[data-detail-next]').disabled=index===rows.length-1;
    const body=detail.querySelector('[data-detail-body]');body.textContent='Consultando detalle…';
    try{const result=await sql('comprobante?id='+encodeURIComponent(row.idRecibo),controller);if(request!==detailSequence||detail.hidden)return;const h=result.comprobante;detailData=result;const unavailable=!Number(h.confirmado)||Number(h.anulada)!==0;detail.querySelector('[data-reprint]').disabled=unavailable;detail.querySelector('[data-recall]').disabled=unavailable;
      body.innerHTML=`<div class="invoice-history-detail-summary"><div>Cliente<strong>${escape(String(h.cliente||'').toUpperCase())}</strong></div><div>Sucursal<strong>${escape(row.sucursal||'Sin sucursal')}</strong></div><div>Fecha<strong>${escape(String(h.fechaComprobante||'').split('-').reverse().join('/'))}</strong></div><div>Tipo<strong>${escape(row.tipo)}</strong></div><div>Estado<strong>${Number(h.anulada)?'Anulada':Number(h.confirmado)?'Confirmada':'Sin confirmar'}</strong></div>${h.cae?`<div>CAE<strong>${escape(h.cae)}</strong></div>`:''}</div><h3>Artículos</h3><table class="invoice-history-table"><thead><tr><th>IDArt</th><th>Descripción</th><th class="money">Cantidad</th><th class="money">Precio unit.</th><th class="money">Importe</th></tr></thead><tbody>${result.articulos.map((a,articleIndex)=>`<tr data-warranty-article="${articleIndex}"><td>${escape(a.idart)}</td><td>${escape(a.descripcion)}</td><td class="money">${escape(number(a.cantidad))}</td><td class="money">${escape(money(a.precio))}</td><td class="money">${escape(money(a.importe))}</td></tr>`).join('')}</tbody></table><h3>Valores recibidos</h3><table class="invoice-history-table"><thead><tr><th>Medio</th><th>Descripción</th><th class="money">Importe</th><th class="money">Dto./rec.</th><th class="money">Total</th></tr></thead><tbody>${result.valores.map(v=>`<tr><td>${escape(v.tipo||v.idTipoPago)}</td><td>${escape(v.descripcion)}</td><td class="money">${escape(money(v.importe))}</td><td class="money">${escape(money(v.impRec))}</td><td class="money">${escape(money(v.total))}</td></tr>`).join('')}</tbody></table><div class="invoice-history-detail-total">Total: ${escape(money(h.total))}</div>`;
    }catch(error){if(request===detailSequence&&!detail.hidden)body.textContent=controller.signal.aborted?'La consulta no respondió a tiempo. Volvé a abrir la boleta.':error.message}
  }
  async function detailAction(action){
    const row=rows[detailIndex];if(!row||actionBusy)return;const adapter=window.CorralonInvoiceHistoryActions?.[action],status=detail.querySelector('[data-action-status]');
    if(!adapter){status.textContent='Facturación todavía está cargando. Reintentá en unos segundos.';return}
    actionBusy=true;detail.querySelector('[data-reprint]').disabled=true;detail.querySelector('[data-recall]').disabled=true;status.textContent=action==='reprint'?'Preparando reimpresión…':'Cargando boleta en Facturación…';
    try{const result=await adapter(Number(row.idRecibo));if(action==='recall'||result?.preview)close();else status.textContent='Ticket enviado a la impresora.'}
    catch(error){status.textContent=error.message}
    finally{actionBusy=false;if(!detail.hidden){detail.querySelector('[data-reprint]').disabled=false;detail.querySelector('[data-recall]').disabled=false}}
  }
  detail.querySelector('[data-reprint]').addEventListener('click',()=>detailAction('reprint'));
  detail.querySelector('[data-recall]').addEventListener('click',()=>detailAction('recall'));
  function closeDetail(){warrantyMenu.hidden=true;detailData=null;detail.hidden=true;detailSequence++;detailController?.abort();detail.querySelector('[data-detail-body]').textContent='';get('[data-rows]').querySelector(`[data-invoice="${detailIndex}"]`)?.focus()}
  function close(){clearTimeout(searchTimer);closeDetail();overlay.hidden=true;sequence++;listController?.abort();rows=[];get('[data-rows]').textContent='';button.focus()}
  button.addEventListener('click',async()=>{
    if(!overlay.hidden)return;overlay.hidden=false;get('[data-search]').value='';page=0;const current=dateText(new Date());get('[data-from]').value=current;get('[data-to]').value=current;get('[data-branch]').innerHTML='<option value="0">Todas las sucursales</option>';
    const selectedPoint=Number(document.getElementById('pos')?.value)||0;
    message('Consultando la sucursal del punto de venta…');get('[data-search]').focus();const controller=new AbortController();
    try{const config=await sql('bootstrap',controller);if(overlay.hidden)return;get('[data-branch]').innerHTML='<option value="0">Todas las sucursales</option>'+config.sucursales.map(s=>`<option value="${Number(s.id)}">${escape(s.nombre)}</option>`).join('');
      const branch=Number((config.puntosVenta||[]).find(p=>Number(p.id)===selectedPoint)?.idSucursal)||0;
      get('[data-branch]').value=String(branch);get('[data-point]').innerHTML='<option value="0">Todos los puntos de venta</option>'+(config.puntosVenta||[]).map(p=>`<option value="${Number(p.id)}">${escape(p.id)} · ${escape(p.nombre)}</option>`).join('');await load();
    }catch(error){if(!overlay.hidden)message('No se pudieron cargar las sucursales: '+error.message,true)}
  });
  get('form').addEventListener('submit',event=>{event.preventDefault();load()});get('[data-close]').addEventListener('click',close);get('[data-prev]').addEventListener('click',()=>load(page-1));get('[data-next]').addEventListener('click',()=>load(page+1));get('[data-branch]').addEventListener('change',()=>load());get('[data-point]').addEventListener('change',()=>load());
  for(const selector of ['[data-from]','[data-to]']){const field=get(selector);field.addEventListener('input',()=>field.setCustomValidity(''));field.addEventListener('change',()=>load())}
  get('[data-search]').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(),350)});
  get('[data-rows]').addEventListener('click',event=>{const row=event.target.closest('[data-invoice]');if(row)openDetail(Number(row.dataset.invoice))});get('[data-rows]').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('tr[data-invoice]')){event.preventDefault();openDetail(Number(event.target.dataset.invoice))}});
  get('form').addEventListener('keydown',event=>{if(event.defaultPrevented)return;const controls=[get('[data-branch]'),get('[data-point]'),get('[data-from]'),get('[data-to]'),get('[data-search]')],index=controls.indexOf(event.target);if(index<0)return;
    if(event.key==='F2'&&event.target.select){event.preventDefault();event.target.select();return}
    if(event.key==='Enter'){event.preventDefault();if(index<controls.length-1){if(event.target.classList.contains('date')&&!dateInput(event.target))return;controls[index+1].focus();controls[index+1].select?.()}else load()}
  });
  detail.querySelector('[data-detail-close]').addEventListener('click',closeDetail);detail.querySelector('[data-detail-prev]').addEventListener('click',()=>openDetail(detailIndex-1));detail.querySelector('[data-detail-next]').addEventListener('click',()=>openDetail(detailIndex+1));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!warrantyMenu.hidden){event.preventDefault();warrantyMenu.hidden=true;}else if(event.key==='Escape'&&!detail.hidden){event.preventDefault();closeDetail()}else if(event.key==='Escape'&&!overlay.hidden){event.preventDefault();close()}});
})();
