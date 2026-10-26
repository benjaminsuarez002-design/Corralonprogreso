(function(){
  if(window.CorralonInvoiceHistory)return;
  const button=document.getElementById('consultInvoices');
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(value)||0);
  const number=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:4}).format(Number(value)||0);
  const styles=document.createElement('style');styles.textContent=`
    .receipt-values-scroll{max-height:88px;overflow:auto;scrollbar-gutter:stable}
    .invoice-receipt-detail .receipt-values-scroll .invoice-history-table th{height:24px}
    .invoice-receipt-detail .receipt-values-scroll .invoice-history-table td{height:32px}
    .invoice-history-overlay{position:fixed;inset:0;z-index:95;background:#0009;display:grid;place-items:center;padding:16px}
    .invoice-history-overlay[hidden]{display:none}.invoice-history-card{background:#fff;border-radius:12px;width:min(1200px,100%);height:min(850px,92dvh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 55px #0005;color:#151515;font:14px Barlow,Arial,sans-serif}
    .invoice-history-head{padding:12px 16px;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.invoice-history-head h2{margin:0;flex:1;font-size:22px}.invoice-history-card button{cursor:pointer;border:1px solid #bbb;border-radius:7px;background:#fff;padding:7px 12px;font:700 14px Barlow,Arial,sans-serif}.invoice-history-card button:disabled{opacity:.45;cursor:default}.invoice-history-card button.primary{background:#ed1019;color:#fff;border-color:#ed1019}
    .invoice-history-filters{padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid #ddd;align-items:end}.invoice-history-filters label{display:grid;gap:4px;font-weight:700}.invoice-history-filters input,.invoice-history-filters select{height:33px;padding:4px 7px;border:1px solid #bbb;border-radius:5px;font:14px Barlow,Arial,sans-serif;max-width:100%}.invoice-history-filters input.date{width:130px}.invoice-history-filters .search{flex:1;min-width:180px}.invoice-history-status{padding:8px 16px;color:#666;min-height:30px}.invoice-history-status.error{color:#b00020}
    .invoice-history-scroll{flex:1;min-height:0;overflow:auto;padding:0 16px}.invoice-history-table{width:100%;border-collapse:collapse;font-size:14px}.invoice-history-table th{position:sticky;top:0;background:#eee;text-align:left;z-index:1}.invoice-history-table th,.invoice-history-table td{padding:9px 8px;border-bottom:1px solid #ddd}.invoice-history-table tbody tr:nth-child(even){background:#f6f6f6}.invoice-history-table tbody tr[data-invoice]{cursor:pointer}.invoice-history-table tbody tr[data-invoice]:hover{background:#ffe8e9}.invoice-history-table .money{text-align:right;white-space:nowrap}.invoice-history-table .cancelled{color:#b00020}.invoice-history-footer{padding:10px 16px;border-top:1px solid #ddd;display:flex;align-items:center;justify-content:space-between;gap:10px}.invoice-history-detail-summary{padding:12px 0;display:flex;gap:12px;flex-wrap:wrap}.invoice-history-detail-summary strong{display:block}.invoice-history-detail-summary>div{min-width:125px}.invoice-history-detail h3{margin:16px 0 8px}.invoice-history-detail-total{font-size:20px;font-weight:800;text-align:right;padding:12px 0}
    
    .invoice-history-card .invoice-history-table th button[data-sort]{display:inline-flex;align-items:center;gap:5px;border:0;border-radius:0;background:transparent!important;color:inherit!important;padding:0;font:inherit;font-weight:700;box-shadow:none;text-align:inherit}.invoice-history-table [data-sort-icon]{font-size:10px;color:#777}.invoice-history-table th[aria-sort="ascending"] [data-sort-icon],.invoice-history-table th[aria-sort="descending"] [data-sort-icon]{color:#ed1019}
    @media print{.invoice-history-overlay{display:none!important}}
  `;styles.textContent+='\n    .invoice-receipt-detail .invoice-history-card{width:min(1330px,100%);font-size:12px;background:#f3f3f3}\n    .invoice-receipt-detail .invoice-history-head{padding:7px 12px;background:white}.invoice-receipt-detail .invoice-history-head h2{font-size:19px}\n    .invoice-receipt-detail .invoice-history-detail{padding:8px 12px;overflow:auto}.receipt-layout{min-width:1080px;max-width:1300px}\n    .receipt-row{display:flex;align-items:center;gap:9px;margin-bottom:5px;white-space:nowrap}.receipt-field{display:flex;align-items:center;gap:3px;font-size:11px;font-weight:700;min-width:0}.receipt-field span{display:block;height:22px;padding:2px 5px;border:1px solid #b9b9b9;background:#fff;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;font-weight:600}.receipt-field span.receipt-number{background:#111;color:#ffef66}.receipt-field span.receipt-highlight{background:#fff5ad}.receipt-field input{margin:0;width:14px;height:14px}\n    .receipt-grid{border:1px solid #999;background:#fff;overflow:auto;margin-top:7px;width:1110px;max-width:100%}.receipt-grid .invoice-history-table{font-size:13px;table-layout:fixed}.receipt-grid .invoice-history-table th,.receipt-grid .invoice-history-table td{padding:2px 5px;height:22px;border-right:1px solid #ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.receipt-grid .invoice-history-table th{font-weight:600;background:#e5e8eb}.receipt-grid .invoice-history-table tr.receipt-empty td{height:22px;background:#fff}.receipt-records{padding:2px 5px;font-size:11px;border-top:1px solid #bbb;background:#ececec}\n    .receipt-values-area{display:flex;align-items:start;gap:16px;width:1110px;margin:3px 0 7px}.receipt-values-area .receipt-grid{width:835px;margin:0}.receipt-tax-summary{width:265px;display:grid;gap:5px;padding-top:1px}.receipt-tax-summary .receipt-field{justify-content:end}.receipt-tax-summary .receipt-field span{text-align:right;width:115px}\n    .receipt-totals .receipt-field span{text-align:right}.receipt-totals .receipt-field .receipt-total{color:#fff;background:#111;font-weight:800}.receipt-actions .invoice-history-footer{background:transparent;justify-content:start;border:1px solid #bbb;padding:5px;margin-top:8px;gap:8px}.receipt-actions .invoice-history-footer [data-action-status]:empty{display:none}.receipt-actions .invoice-history-footer button{border-radius:3px;height:34px;font-size:12px}\n';styles.textContent+=`
    .invoice-receipt-detail .invoice-history-card{height:calc(100vh - 32px);height:calc(100dvh - 32px);max-height:calc(100dvh - 32px);min-height:0}
    .invoice-receipt-detail .invoice-history-head{flex-shrink:0}
    .invoice-receipt-detail .invoice-history-detail{display:flex;min-height:0;overflow-x:auto;overflow-y:hidden}
    .invoice-receipt-detail .receipt-layout{display:flex;flex-direction:column;flex:1;min-height:0;height:100%}
    .invoice-receipt-detail .receipt-layout>*{flex-shrink:0}
    .invoice-receipt-detail .receipt-articles{display:flex;flex-direction:column;flex:1 1 0;min-height:0;overflow:hidden}
    .receipt-articles-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
    .receipt-articles-scroll thead th{position:sticky;top:0;z-index:1}
    .receipt-articles .receipt-records{flex-shrink:0}
`;document.head.appendChild(styles);
  // Cargar los ajustes de telefono tambien cuando este modulo se reutiliza en Caja.
  const mobileStyles=document.querySelector('link[data-facturacion-mobile]')||document.createElement('link');
  mobileStyles.rel='stylesheet';mobileStyles.href='facturacion-mobile.css';mobileStyles.setAttribute('data-facturacion-mobile','');
  document.head.appendChild(mobileStyles);
  const overlay=document.createElement('div');overlay.className='invoice-history-overlay';overlay.hidden=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Consultar boletas');
  overlay.innerHTML=`<section class="invoice-history-card"><header class="invoice-history-head"><h2>Consultar boletas</h2><button data-close type="button">Cerrar</button></header><form class="invoice-history-filters"><label>Sucursal<select data-branch><option value="0">Todas las sucursales</option></select></label><label>Punto de venta<select data-point><option value="0">Todos los puntos de venta</option></select></label><label>Desde<input class="date" data-from inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" required></label><label>Hasta<input class="date" data-to inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" required></label><label class="search">Cliente o número<input data-search autocomplete="off" placeholder="Buscar cliente o boleta…" maxlength="80"></label><label class="search">Artículo<input data-article autocomplete="off" placeholder="Descripción, IDArt o código de proveedor…" maxlength="100"></label><button class="primary" type="submit">Consultar</button></form><div class="invoice-history-status" data-status role="status" aria-live="polite"></div><div class="invoice-history-scroll"><table class="invoice-history-table"><thead><tr><th aria-sort="none"><button type="button" data-sort="numero">Número <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="tipo">Tipo <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="cliente">Cliente <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="sucursal">Sucursal <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="fecha">Fecha <span data-sort-icon aria-hidden="true">↕</span></button></th><th class="money" aria-sort="none"><button type="button" data-sort="total">Total <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="estado">Estado <span data-sort-icon aria-hidden="true">↕</span></button></th><th></th></tr></thead><tbody data-rows></tbody></table></div><footer class="invoice-history-footer"><span data-position></span><span data-more-status role="status" aria-live="polite"></span><button data-retry-more type="button" hidden>Reintentar carga</button></footer></section>`;document.body.appendChild(overlay);
  const get=selector=>overlay.querySelector(selector),status=get('[data-status]');
  const detail=document.createElement('div');detail.className='invoice-history-overlay';detail.hidden=true;detail.style.zIndex='96';detail.classList.add('invoice-receipt-detail');detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');detail.setAttribute('aria-label','Detalle de boleta');
  detail.innerHTML=`<section class="invoice-history-card"><header class="invoice-history-head"><h2 data-title>Boleta</h2><button data-detail-prev type="button" aria-label="Boleta anterior">‹</button><span data-detail-position></span><button data-detail-next type="button" aria-label="Boleta siguiente">›</button><button data-detail-close type="button">Cerrar</button></header><div class="invoice-history-scroll invoice-history-detail" data-detail-body></div><footer class="invoice-history-footer"><span data-action-status role="status"></span><div><button data-preview type="button" disabled>Vista previa</button> <button data-reprint type="button" disabled>Reimprimir</button> <button data-recall class="primary" type="button" disabled>Llamar a facturar</button></div></footer></section>`;document.body.appendChild(detail);
  let historyConfig=null,returnFocus=null,directOpenSequence=0,detailOptions={},reviewSelection=null;
  const annulButton=document.createElement('button');annulButton.type='button';annulButton.dataset.annul='';annulButton.textContent='Anular boleta';annulButton.hidden=true;annulButton.disabled=true;annulButton.style.cssText='margin-left:8px;color:#b00020;border-color:#e4aab3;background:#fff3f4';
  detail.querySelector('.invoice-history-footer>div').appendChild(annulButton);
  let rows=[],page=0,hasMore=false,listController=null,detailController=null,sequence=0,detailSequence=0,detailIndex=-1,searchTimer=null,actionBusy=false,detailData=null;
  let listLoading=false,moreError=false,listQuery='',totalRecords=null;
  let sortField='',sortDirection='';
  function paintSort(){
    overlay.querySelectorAll('[data-sort]').forEach(button=>{
      const active=button.dataset.sort===sortField;
      button.closest('th').setAttribute('aria-sort',active?(sortDirection==='asc'?'ascending':'descending'):'none');
      button.querySelector('[data-sort-icon]').textContent=active?(sortDirection==='asc'?'▲':'▼'):'↕';
      button.title=active?(sortDirection==='asc'?'Ordenar descendente':'Restaurar orden original'):'Ordenar ascendente';
    });
  }
  overlay.querySelector('thead').addEventListener('click',event=>{
    const button=event.target.closest('[data-sort]');if(!button)return;
    if(sortField!==button.dataset.sort){sortField=button.dataset.sort;sortDirection='asc'}
    else if(sortDirection==='asc')sortDirection='desc';else{sortField='';sortDirection=''}
    paintSort();load(0);
  });
  paintSort();
  let cancellationBusy=false;
  function valuesUser(){return window.CorralonFunciones?.menuSessionUser?.()||{}}
  function isAdministrator(){if(detailOptions.readOnly===true)return false;return typeof detailOptions.allowAnnul==='boolean'?detailOptions.allowAnnul:window.CorralonFunciones.menuUserIsAdministrator('facturacion',valuesUser());}
  const reviewLinkButton=document.createElement('button');reviewLinkButton.type='button';reviewLinkButton.dataset.reviewLink='';reviewLinkButton.className='primary';reviewLinkButton.textContent='Resolver pendiente con esta boleta';reviewLinkButton.hidden=true;detail.querySelector('.invoice-history-footer>div').appendChild(reviewLinkButton);
  reviewLinkButton.onclick=async()=>{
    if(!reviewSelection||!detailData?.comprobante||actionBusy)return;
    const header=detailData.comprobante;if(!Number(header.confirmado)||Number(header.anulada)){detail.querySelector('[data-action-status]').textContent='Elegí una boleta confirmada y sin anular.';return;}
    if(!confirm('¿Resolver el pendiente con la boleta '+header.numero+' de '+header.cliente+', por '+money(header.totalAbsoluto)+'? Verificá artículos y pagos. No se emitirá otra venta.'))return;
    actionBusy=true;reviewLinkButton.disabled=true;try{await reviewSelection.onSelect(detailData);reviewSelection=null;actionBusy=false;closeDetail();window.CorralonInvoiceSections?.show('invoice');}
    catch(error){detail.querySelector('[data-action-status]').textContent=error.message;}finally{actionBusy=false;reviewLinkButton.disabled=false;}
  };
  function historyActions(){return detailOptions.actions||window.CorralonInvoiceHistoryActions||{}}
  function refreshAnnulButton(){
    annulButton.hidden=!isAdministrator();
    annulButton.disabled=actionBusy||!detailData?.versionAnulacion||!Number(detailData?.comprobante?.confirmado)||Boolean(Number(detailData?.comprobante?.anulada))||Boolean(detailData?.bloqueoAnulacionFiscal)||Boolean(detailData?.valuesDirty);
    annulButton.title=detailData?.bloqueoAnulacionFiscal?'Debe hacer una nota de crédito/débito.':detailData?.valuesDirty?'Guardá los valores antes de anular.':'';
  }
  function valueNumber(value){if(typeof value==='number')return value;const text=String(value??'').replace(/[^\d,.-]/g,'');return Number(text.includes(',')?text.replace(/\./g,'').replace(',','.'):text)||0;}
  function receiptValuesBasis(result=detailData){
    if(result.valuesArticleBasis==null){const h=result.comprobante;result.valuesArticleBasis=h.totalArticulos!=null?Math.abs(Number(h.totalArticulos)):result.articulos?.length?Math.abs(result.articulos.reduce((sum,row)=>sum+Number(row.importe||0),0)):Math.abs(Number(h.total))-Number(h.ajusteEmitido??result.valores.reduce((sum,row)=>sum+Number(row.impRec||0),0));}
    return Math.round(result.valuesArticleBasis*100)/100;
  }
  function receiptValuesBalance(values=detailData.valores){
    const round=value=>Math.round(value*100)/100,issued=Math.abs(Number(detailData.comprobante.total)),articles=receiptValuesBasis(),base=values.reduce((sum,row)=>sum+Number(row.importe||0),0),adjustment=values.reduce((sum,row)=>sum+Number(row.impRec||0),0),total=values.reduce((sum,row)=>sum+Number(row.total||0),0),expectedAdjustment=round(issued-articles);
    const cashDifference=round(total-issued),baseDifference=round(articles-base),adjustmentDifference=round(adjustment-expectedAdjustment);
    return {issued,articles,base,adjustment,total,expectedAdjustment,cashDifference,baseDifference,adjustmentDifference,invalid:cashDifference!==0||baseDifference!==0||adjustmentDifference!==0};
  }
  function blankValue(){const type=valueTypes().find(p=>Number(p.clase)===1)||valueTypes()[0],remaining=Math.max(0,Math.round((Math.abs(Number(detailData.comprobante.total))-detailData.valores.reduce((sum,v)=>sum+Number(v.total||0),0))*100)/100);return{orden:null,idTipoPago:type?.id||0,tipo:type?.nombre||'',clase:type?.clase||0,idTarjeta:0,tarjeta:'Ninguna',importe:remaining,coef:0,impRec:0,total:remaining,cuotas:0,descripcion:''};}
  function valueInput(v,i,key,text){return `<input data-value-index="${i}" data-value-key="${key}" ${key==='descripcion'?'maxlength="30"':'inputmode="decimal" class="money"'} value="${escape(text)}" style="width:100%;height:26px;border:0;background:transparent;padding:2px 5px;font:inherit;${key==='descripcion'?'':'text-align:right'}">`;}
  function editableValuesTable(values){return `<div class="receipt-grid" style="width:835px"><div class="receipt-values-scroll"><table class="invoice-history-table" data-edit-values><colgroup>${[15,15,14,7,15,10,10,11,3].map(w=>`<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${['Tipo de valor','Importe','Tarjeta / cuenta','Cuotas','Descripción','% Dto./Rec.','$ Dto./Rec.','Total',''].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${values.map((v,i)=>{const cells=valueCells(v,i);return `<tr data-value-row="${i}"><td>${cells[0]}</td><td>${valueInput(v,i,'importe',money(v.importe))}</td><td>${cells[1]}</td><td>${cells[2]}</td><td>${valueInput(v,i,'descripcion',v.descripcion||'')}</td><td>${valueInput(v,i,'coef',number(Number(v.coef||0)*100)+' %')}</td><td>${valueInput(v,i,'impRec',money(v.impRec))}</td><td>${valueInput(v,i,'total',money(v.total))}</td><td><button type="button" data-remove-value="${i}" aria-label="Quitar valor" style="border:0;padding:0;color:#d00008;background:transparent">×</button></td></tr>`;}).join('')}</tbody></table></div><div class="receipt-records" style="display:flex;justify-content:space-between"><span>${values.length} valores</span><button type="button" data-add-value style="padding:0 5px;font-size:11px">+ Renglón</button></div><div class="receipt-values-difference" style="padding:4px 5px;text-align:right">Diferencia: <strong data-values-difference></strong></div></div>`;}
  function updateValueTotals(){
    const h=detailData.comprobante,sign=Number(h.total)<0?-1:1;h.efectivo=0;h.tarjeta=0;h.cuentaCorriente=0;h.cheque=0;
    for(const v of detailData.valores){const kind=Number((historyConfig.tiposPago||[]).find(p=>Number(p.id)===Number(v.idTipoPago))?.clase||v.clase);const bucket=({1:'efectivo',2:'cheque',3:'cheque',5:'tarjeta',6:'cuentaCorriente'})[kind];if(bucket)h[bucket]+=Number(v.total||0)*sign;}
    detailData.valuesDirty=true;
  }
  function reconcileCashDifference(){
    let keptAutomatic=false;
    detailData.valores=detailData.valores.filter(v=>{if(!v.autoDifference)return true;if(keptAutomatic)return false;keptAutomatic=true;return true;});
    const values=detailData.valores,cash=valueTypes().find(p=>Number(p.clase)===1);if(!cash)return;
    const automatic=values.find(v=>v.autoDifference),manual=values.filter(v=>!v.autoDifference),state=receiptValuesBalance(),round=value=>Math.round(value*100)/100;
    const remainingBase=round(state.articles-manual.reduce((sum,v)=>sum+Number(v.importe||0),0)),remainingAdjustment=round(state.expectedAdjustment-manual.reduce((sum,v)=>sum+Number(v.impRec||0),0)),remaining=round(remainingBase+remainingAdjustment);
    if(remainingBase>0&&remaining>0){const row=automatic||{...blankValue(),idTipoPago:cash.id,tipo:cash.nombre,clase:cash.clase,autoDifference:true};row.importe=remainingBase;row.impRec=remainingAdjustment;row.coef=remainingAdjustment/remainingBase;row.total=remaining;if(!automatic)values.push(row);}
    else if(automatic)values.splice(values.indexOf(automatic),1);
    updateValueTotals();
  }
  function refreshValueOutputs(){
    refreshAnnulButton();
    const values=detailData.valores,total=values.reduce((sum,v)=>sum+Number(v.total||0),0),difference=Math.round((total-Math.abs(Number(detailData.comprobante.total)))*100)/100;
    const state=receiptValuesBalance();let output=detail.querySelector('[data-values-difference]');
    if(!output){const line=document.createElement('div');line.className='receipt-values-difference';line.style.cssText='padding:4px 5px;text-align:right';line.innerHTML='Diferencia: <strong data-values-difference></strong>';detail.querySelector('.receipt-values-area .receipt-grid')?.append(line);output=line.querySelector('strong');}
    if(output){output.textContent=money(state.cashDifference||state.baseDifference||state.adjustmentDifference);output.style.color=state.invalid?'#b00020':'#087a20';output.title='Cobro: '+money(state.cashDifference)+' · Base: '+money(state.baseDifference)+' · Ajuste: '+money(state.adjustmentDifference);
      let info=detail.querySelector('[data-values-adjustment-info]');if(!info){info=document.createElement('div');info.dataset.valuesAdjustmentInfo='';info.style.cssText='padding:4px 5px;font-size:12px;line-height:1.4';output.parentElement.after(info);}info.hidden=!state.invalid&&!state.expectedAdjustment;info.style.color=state.invalid?'#b00020':'#173b65';info.textContent='Artículos: '+money(state.articles)+' · Descuento/recargo emitido: '+money(state.expectedAdjustment)+' · En valores: '+money(state.adjustment)+(state.invalid?' · Revisá la base y el ajuste antes de guardar.':'');
      let restore=detail.querySelector('[data-restore-issued-adjustment]');if(!restore&&canEditValues()){restore=document.createElement('button');restore.type='button';restore.dataset.restoreIssuedAdjustment='';restore.textContent='Reasignar ajuste emitido';restore.style.cssText='margin:4px 5px;padding:5px 9px;font-size:12px';info.after(restore);}if(restore)restore.hidden=!canEditValues()||!state.invalid||state.cashDifference!==0;
    }
    for(const [label,value] of [['Efectivo:',detailData.comprobante.efectivo],['Tarjeta:',detailData.comprobante.tarjeta],['Cta. Cte.:',detailData.comprobante.cuentaCorriente],['Cheque:',detailData.comprobante.cheque],['Total Valores:',total],['Dto./Rec.:',values.reduce((sum,v)=>sum+Number(v.impRec||0),0)]]){
      const field=[...detail.querySelectorAll('.receipt-field')].find(el=>el.firstChild.textContent===label)?.querySelector('span');if(field)field.textContent=money(value);
    }
  }
  function canEditValues(){if(reviewSelection)return false;if(detailOptions.readOnly===true)return false;const user=valuesUser(),allowed=String(user.nivel||'').toLowerCase()==='administrador'||(user.permisos?.includes('facturacion')&&user.permisosEdicion?.includes('facturacion'));return (allowed || detailOptions.allowEditValues===true)&&Number(detailData?.comprobante?.confirmado)!==0&&!Number(detailData?.comprobante?.anulada)&&Boolean(detailData?.versionValores)}
  function valueRules(){try{return window.CorralonMediosPago?.normalize(JSON.parse(localStorage.getItem('corralon_facturacion_medios_pago_v1')||'null'),historyConfig)}catch{return window.CorralonMediosPago?.normalize(null,historyConfig)}}
  function valueTypes(){const rules=valueRules();return(historyConfig?.tiposPago||[]).filter(p=>[1,3,5,6].includes(Number(p.clase))&&Number(p.id)!==14&&(!window.CorralonMediosPago||window.CorralonMediosPago.allowsVoucher(rules,p.id,detailData.comprobante.idComprobante)))}
  function valueCards(value){const rules=valueRules();return(historyConfig?.tarjetas||[]).filter(c=>!window.CorralonMediosPago||window.CorralonMediosPago.allowsCard(rules,value.idTipoPago,c.id))}
  function valueSelect(value,index,key,choices){return `<select data-value-index="${index}" data-value-key="${key}" aria-label="${key==='idTipoPago'?'Tipo de valor':key==='idTarjeta'?'Tarjeta o cuenta':'Cuotas'}" style="width:100%;font:inherit;border:1px solid #bbb;background:white">${choices.map(c=>`<option value="${Number(c.id)}" ${Number(c.id)===Number(value[key])?'selected':''}>${escape(c.nombre)}</option>`).join('')}</select>`}
  function valueCells(value,index){
    if(!canEditValues())return [escape(value.tipo||value.idTipoPago),escape(value.tarjeta||'Ninguna'),escape(value.cuotas??0)];
    const types=valueTypes();if(!types.some(p=>Number(p.id)===Number(value.idTipoPago)))types.push({id:value.idTipoPago,nombre:value.tipo});
    const cls=Number((historyConfig?.tiposPago||[]).find(p=>Number(p.id)===Number(value.idTipoPago))?.clase||value.clase),cards=[{id:0,nombre:'Ninguna'},...valueCards(value)],plans=[{id:0,nombre:'0'},...(historyConfig?.tarjetasCuotas||[]).filter(p=>Number(p.idTarjeta)===Number(value.idTarjeta)).map(p=>({id:p.cuotas,nombre:p.cuotas}))];
    if(value.idTarjeta&&!cards.some(c=>Number(c.id)===Number(value.idTarjeta)))cards.push({id:value.idTarjeta,nombre:value.tarjeta});
    return [valueSelect(value,index,'idTipoPago',types),[3,5].includes(cls)?valueSelect(value,index,'idTarjeta',cards):escape(value.tarjeta||'Ninguna'),cls===5?valueSelect(value,index,'cuotas',plans):escape(value.cuotas??0)];
  }
  function fitReceiptDetail(){
    if(sectionActive&&detail.parentElement===sectionHost){
      if(window.matchMedia('print').matches)return;
      const card=detail.querySelector('.invoice-history-card');
      // La misma referencia y redondeo que fitInvoiceForm; nunca depende del scroll.
      const width=Math.max(1,window.innerWidth-8),height=Math.max(1,window.innerHeight-8);
      const scale=Math.max(.01,Math.floor(Math.min(width/1760,height/880)*1000)/1000);
      const header=document.querySelector('body > .app > .topbar');
      const top=Math.ceil(header?.getBoundingClientRect().height||70*scale)+8;
      const availableWidth=Math.max(1,window.innerWidth-20);
      const availableHeight=Math.max(1,window.innerHeight-top-10);
      sectionHost.style.setProperty('--receipt-fit-top',top+'px');
      detail.classList.add('receipt-scaled-desktop','receipt-fit-section');
      card.style.setProperty('--receipt-scale',String(scale));
      card.style.setProperty('--receipt-fit-width',Math.floor(availableWidth/scale)+'px');
      card.style.setProperty('--receipt-fit-height',Math.floor(availableHeight/scale)+'px');
      return;
    }
    detail.classList.remove('receipt-fit-section');
    const card=detail.querySelector('.invoice-history-card');
    const desktop=window.innerWidth>700;detail.classList.toggle('receipt-scaled-desktop',desktop);
    if(!desktop){card.style.removeProperty('--receipt-scale');return;}
    const width=detail.clientWidth||window.innerWidth,height=detail.clientHeight||window.innerHeight;
    card.style.setProperty('--receipt-scale',String(Math.max(.01,Math.min((width-28)/1450,(height-28)/850))));
  }
  window.addEventListener('resize',()=>{if(!detail.hidden)fitReceiptDetail();});
  function decorateReceiptDetail(body){
    const layout=body.querySelector('.receipt-layout');if(!layout)return;fitReceiptDetail();
    const heading=(label)=>{const h=document.createElement('h3');h.className='receipt-section-title';h.textContent=label;return h;};
    const card=(label)=>{const section=document.createElement('section');section.className='receipt-section';section.append(heading(label));return section;};
    const main=card('Datos principales');main.classList.add('receipt-main-data');
    const mainRows=[...layout.children].filter(el=>el.classList.contains('receipt-row')&&!el.classList.contains('receipt-totals'));
    if(mainRows.length){layout.insertBefore(main,mainRows[0]);main.append(...mainRows);}
    const articles=layout.querySelector('.receipt-articles');articles.classList.add('receipt-section');
    const articleTitle=heading('Detalle de artículos'),search=document.createElement('input');search.type='search';search.dataset.receiptArticleSearch='';search.placeholder='Buscar artículo…';search.setAttribute('aria-label','Buscar en los artículos del comprobante');articleTitle.append(search);articles.prepend(articleTitle);
    const area=layout.querySelector('.receipt-values-area'),values=area?.querySelector('.receipt-grid'),tax=area?.querySelector('.receipt-tax-summary');
    if(values){values.classList.add('receipt-section','receipt-values-card');values.prepend(heading('Valores recibidos'));}
    if(tax){tax.classList.add('receipt-section');tax.prepend(heading('Resumen de totales'));}
    const totals=card('Totales y otros datos');totals.classList.add('receipt-other-data');
    const totalsRows=[...layout.children].filter(el=>el.classList.contains('receipt-totals'));
    if(totalsRows.length){layout.insertBefore(totals,totalsRows[0]);totals.append(...totalsRows);}
    const footerButtons=detail.querySelector('.invoice-history-footer>div');
    footerButtons.querySelector('[data-save-values]')?.remove();
    const save=layout.querySelector('[data-save-values]');if(save)footerButtons.prepend(save);
  }
  detail.addEventListener('input',event=>{
    if(!event.target.matches('[data-receipt-article-search]'))return;
    const query=event.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const panel=event.target.closest('.receipt-articles');let visible=0;
    panel.querySelectorAll('tbody tr[data-warranty-article]').forEach(row=>{row.hidden=!row.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query);if(!row.hidden)visible++;});
    panel.querySelectorAll('tr.receipt-empty').forEach(row=>row.hidden=Boolean(query));
    panel.querySelector('.receipt-records').textContent=query?`${visible} de ${detailData?.articulos?.length||0} artículos`: `Registro: ${visible?'1':'0'} de ${visible}`;
  });
  function redrawValues(){const body=detail.querySelector('[data-detail-body]'),footer=detail.querySelector('.invoice-history-footer');if(footer&&body.contains(footer))detail.querySelector('.invoice-history-card').appendChild(footer);body.innerHTML=receiptLayout(detailData,rows[detailIndex]);decorateReceiptDetail(body);body.querySelector('.receipt-actions').appendChild(footer);footer.style.display='';refreshValueOutputs();}
  detail.addEventListener('input',event=>{
    const input=event.target.closest('input[data-value-key]');if(!input||!canEditValues()||actionBusy)return;
    const row=detailData.valores[Number(input.dataset.valueIndex)],key=input.dataset.valueKey;
    if(key!=='descripcion')row.autoDifference=false;
    row[key]=key==='descripcion'?input.value:valueNumber(input.value)/(key==='coef'?100:1);
    if(key==='total'&&Number(row.coef)>-1){const target=Math.round(Number(row.total)*100)/100,base=Math.round(target/(1+Number(row.coef||0))*100)/100;row.importe=base;row.impRec=Math.round((target-base)*100)/100;row.coef=base?row.impRec/base:0;row.total=target;}
    else if(key!=='descripcion')window.CorralonMediosPago.adjustValue(row,key,valueNumber);
    updateValueTotals();
    for(const field of input.closest('tr').querySelectorAll('input[data-value-key]')){if(field===input)continue;const k=field.dataset.valueKey;field.value=k==='descripcion'?row[k]:k==='coef'?number(row.coef*100)+' %':money(row[k]);}
    refreshValueOutputs();detail.querySelector('[data-action-status]').textContent='Cambios sin guardar.';
    if(key!=='descripcion'){
      const raw=input.value,start=input.selectionStart,end=input.selectionEnd;reconcileCashDifference();redrawValues();
      const replacement=detail.querySelector(`[data-value-index="${detailData.valores.indexOf(row)}"][data-value-key="${key}"]`);if(replacement){replacement.value=raw;replacement.focus();replacement.setSelectionRange(start,end);}
    }
  });
  detail.addEventListener('keydown',event=>{
    const input=event.target.closest('[data-value-key]');if(!input||!canEditValues()||actionBusy||event.defaultPrevented)return;
    if(event.key==='F2'&&input.select){event.preventDefault();input.select();return;}
    if(event.key==='Enter'){event.preventDefault();const controls=[...detail.querySelectorAll('[data-edit-values] [data-value-key]:not([disabled])')],index=controls.indexOf(input),row=Number(input.dataset.valueIndex),key=input.dataset.valueKey;input.dispatchEvent(new Event('change',{bubbles:true}));const target=detail.querySelector(`[data-value-index="${row}"][data-value-key="${key}"]`),next=[...detail.querySelectorAll('[data-edit-values] [data-value-key]:not([disabled])')];(next[next.indexOf(target)+1]||detail.querySelector('[data-add-value]'))?.focus();}
  });
  detail.addEventListener('change',event=>{
    const input=event.target.closest('[data-value-key]');if(!input||!canEditValues()||actionBusy)return;
    if(input.tagName==='INPUT'){const key=input.dataset.valueKey,row=detailData.valores[Number(input.dataset.valueIndex)];input.value=key==='descripcion'?row[key]:key==='coef'?number(row.coef*100)+' %':money(row[key]);return;}
    const value=detailData.valores[Number(input.dataset.valueIndex)],key=input.dataset.valueKey;value[key]=Number(input.value);
    value.autoDifference=false;
    const type=(historyConfig.tiposPago||[]).find(p=>Number(p.id)===Number(value.idTipoPago)),cls=Number(type?.clase||value.clase);
    if(key==='idTipoPago'){value.tipo=type.nombre;value.clase=cls;value.idTarjeta=0;value.tarjeta='Ninguna';value.cuotas=0;}
    if(key==='idTarjeta'){value.tarjeta=(historyConfig.tarjetas||[]).find(c=>Number(c.id)===value.idTarjeta)?.nombre||'Ninguna';value.cuotas=cls===5?Number((historyConfig.tarjetasCuotas||[]).find(p=>Number(p.idTarjeta)===value.idTarjeta)?.cuotas)||0:0;}
    // Cambiar la clasificacion del pago conserva el descuento/recargo y total emitidos.
    reconcileCashDifference();redrawValues();detail.querySelector('[data-action-status]').textContent='Cambios sin guardar.';
    const index=detailData.valores.indexOf(value),account=detail.querySelector('[data-value-index="'+index+'"][data-value-key="idTarjeta"]');
    if(key==='idTipoPago'&&[3,5].includes(cls)&&account)window.CorralonFunciones.focusField(account,{openDropdown:true});
    else if(key==='idTarjeta'&&account){const controls=[...detail.querySelectorAll('[data-edit-values] [data-value-key]:not([disabled])')],next=controls[controls.indexOf(account)+1];if(next)window.CorralonFunciones.focusField(next,{openDropdown:next.tagName==='SELECT'});}
  });
  detail.addEventListener('click',async event=>{
    if(canEditValues()&&!actionBusy&&event.target.closest('[data-restore-issued-adjustment]')){
      const state=receiptValuesBalance(),active=detailData.valores.filter(row=>Number(row.total)>0),totalCents=Math.round(state.total*100),baseCents=Math.round(state.articles*100);let allocated=0;
      if(state.cashDifference!==0||!active.length||baseCents<=0)return;
      const prepared=active.map((row,index)=>{const base=index===active.length-1?baseCents-allocated:Math.round(baseCents*Math.round(Number(row.total)*100)/totalCents);allocated+=base;const amount=Math.round(Number(row.total)*100),fee=amount-base;return {row,importe:base/100,impRec:fee/100,coef:base?fee/base:0};});
      if(prepared.some(value=>value.importe<=0||value.coef< -1||value.coef>5)){detail.querySelector('[data-action-status]').textContent='No se puede repartir este ajuste automáticamente. Revisá los importes de cada valor.';return;}
      detailData.valores=active;for(const value of prepared)Object.assign(value.row,{importe:value.importe,impRec:value.impRec,coef:value.coef,autoDifference:false});updateValueTotals();redrawValues();detail.querySelector('[data-action-status]').textContent='Ajuste emitido reasignado. Revisá los valores y pulsá Guardar valores.';return;
    }
    if(canEditValues()&&!actionBusy){if(event.target.closest('[data-add-value]')){detailData.valores.push(blankValue());updateValueTotals();redrawValues();detail.querySelector(`[data-value-row="${detailData.valores.length-1}"] input`)?.focus();return;}const remove=event.target.closest('[data-remove-value]');if(remove){detailData.valores.splice(Number(remove.dataset.removeValue),1);reconcileCashDifference();redrawValues();detail.querySelector('[data-action-status]').textContent='Cambios sin guardar.';return;}}
    if(!event.target.closest('[data-save-values]')||!canEditValues()||actionBusy)return;
    const pending=detailData.valores.filter(v=>Number(v.importe)!==0||Number(v.impRec)!==0||String(v.descripcion||'').trim()),difference=Math.round((pending.reduce((sum,v)=>sum+Number(v.total||0),0)-Math.abs(Number(detailData.comprobante.total)))*100)/100;
    if(!pending.length||pending.some(v=>Number(v.importe)<=0)){detail.querySelector('[data-action-status]').textContent='Cada valor cargado debe tener un importe mayor que cero.';return;}
    const balance=receiptValuesBalance(pending);
    if(balance.invalid){detail.querySelector('[data-action-status]').textContent=balance.cashDifference!==0?'Los valores deben coincidir con el total de la boleta. La diferencia debe ser cero.':'Los valores no conservan la base de artículos y el descuento/recargo emitido. Reasigná el ajuste antes de guardar.';return;}
    actionBusy=true;detail.querySelectorAll('button,select,input[data-value-key]').forEach(c=>c.disabled=true);const status=detail.querySelector('[data-action-status]');status.textContent='Guardando valores…';
    try{const payload={usuarioId:valuesUser().id,idRecibo:rows[detailIndex].idRecibo,version:detailData.versionValores,valores:pending.map(v=>({orden:v.orden??null,idTipoPago:v.idTipoPago,idTarjeta:v.idTarjeta||0,cuotas:v.cuotas||0,importe:v.importe,impRec:v.impRec||0,coef:v.coef||0,descripcion:v.descripcion||''}))};
      if(detailOptions.saveValues)await detailOptions.saveValues(payload);
      else {const response=await fetch('/api/facturacion/comprobante-valores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'No se pudieron guardar los valores.');}
      actionBusy=false;await openDetail(detailIndex);detail.querySelector('[data-action-status]').textContent='Valores actualizados.';}
    catch(error){status.textContent=error.message;detail.querySelectorAll('button,select,input[data-value-key]').forEach(c=>c.disabled=false);}
    finally{actionBusy=false;detail.querySelector('[data-detail-close]').disabled=false;detail.querySelector('[data-detail-prev]').disabled=detailIndex===0;detail.querySelector('[data-detail-next]').disabled=detailIndex===rows.length-1;detail.querySelector('[data-preview]').disabled=!historyActions().preview||detailData?.valuesDirty;detail.querySelector('[data-reprint]').disabled=!historyActions().reprint||detailData?.valuesDirty;detail.querySelector('[data-recall]').disabled=!historyActions().recall||detailData?.valuesDirty;}
  });
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
    detail.querySelectorAll('[data-preview],[data-reprint],[data-recall],[data-detail-prev],[data-detail-next]').forEach(control=>control.disabled=true);
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
      if(!detail.hidden){const unavailable=!Number(header.confirmado)||Boolean(Number(header.anulada));detail.querySelector('[data-preview]').disabled=unavailable||!historyActions().preview;detail.querySelector('[data-reprint]').disabled=unavailable;detail.querySelector('[data-recall]').disabled=!Number((detailData?.comprobante)?.confirmado);detail.querySelector('[data-detail-prev]').disabled=detailIndex===0;detail.querySelector('[data-detail-next]').disabled=detailIndex===rows.length-1;}
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
  function pager(){
    get('[data-position]').textContent=`${rows.length} boletas cargadas de ${totalRecords===null?'…':totalRecords}`;
    get('[data-more-status]').textContent=listLoading?'Cargando boletas…':moreError?'No se pudieron cargar más boletas.':hasMore?'Deslizá hacia abajo para cargar más.':rows.length?'No hay más boletas.':'';
    get('[data-retry-more]').hidden=!moreError;
  }
  function loadMore(){if(!overlay.hidden&&detail.hidden&&!listLoading&&!moreError&&hasMore)load(page+1)}
  get('.invoice-history-scroll').addEventListener('scroll',event=>{
    const panel=event.currentTarget;
    if(panel.scrollHeight-panel.scrollTop-panel.clientHeight<=80)loadMore();
  },{passive:true});
  get('[data-retry-more]').addEventListener('click',()=>{moreError=false;loadMore()});
  function normalizeReceiptSearch(value){
    const text=String(value??'').trim();
    const parts=text.match(/^(\d{1,4})\s*[-–—]\s*(\d{1,8})$/);
    return parts?parts[1].padStart(4,'0')+'-'+parts[2].padStart(8,'0'):text;
  }
  function completeReceiptSearch(){const field=get('[data-search]');field.value=normalizeReceiptSearch(field.value)}
  get('[data-search]').addEventListener('blur',completeReceiptSearch);
  get('[data-search]').addEventListener('keydown',event=>{if(event.key==='Enter')completeReceiptSearch()});
  async function load(targetPage=0){
    const append=targetPage>0;
    if(append&&(listLoading||!hasMore||!listQuery))return;
    let params;
    if(append){params=new URLSearchParams(listQuery);params.set('pagina',String(targetPage))}
    else{
      clearTimeout(searchTimer);
      const search=normalizeReceiptSearch(get('[data-search]').value);
      const specificReceipt=/^\d{4}-\d{8}$/.test(search);
      // Una boleta completa se busca en todas las fechas y sucursales sin alterar los filtros visibles.
      const from=specificReceipt?'1753-01-01':dateInput(get('[data-from]'));
      const to=specificReceipt?'9998-12-31':dateInput(get('[data-to]'));
      if(!from||!to)return;
      if(from>to){message('La fecha Desde debe ser anterior o igual a Hasta.',true);return}
      if(specificReceipt)for(const selector of ['[data-from]','[data-to]'])get(selector).setCustomValidity('');
      params=new URLSearchParams({desde:from,hasta:to,sucursal:specificReceipt?'0':get('[data-branch]').value,puntoVenta:specificReceipt?'0':get('[data-point]').value,buscar:search,articulo:specificReceipt?'':get('[data-article]').value.trim(),pagina:'0',orden:sortField,direccion:sortDirection});
      listQuery=params.toString();rows=[];page=0;hasMore=false;totalRecords=null;get('[data-rows]').innerHTML='';get('.invoice-history-scroll').scrollTop=0;
    }
    listController?.abort();const controller=listController=new AbortController(),request=++sequence;
    listLoading=true;moreError=false;pager();if(!append)message('Consultando boletas…');
    try{
      const result=await sql('consultar-comprobantes?'+params,controller);if(request!==sequence||overlay.hidden)return;
      page=result.pagina;hasMore=Boolean(result.hayMas);totalRecords=Number(result.totalComprobantes)||0;
      const seen=new Set(rows.map(row=>Number(row.idRecibo))),added=result.comprobantes.filter(row=>!seen.has(Number(row.idRecibo))),offset=rows.length;
      rows.push(...added);
      get('[data-rows]').insertAdjacentHTML('beforeend',added.map((r,index)=>{const i=offset+index;return `<tr data-invoice="${i}" tabindex="0" aria-label="Abrir boleta ${escape(r.numero)}"><td>${escape(r.numero)}</td><td>${escape(r.tipo)}</td><td>${escape(String(r.cliente||'').toUpperCase())}</td><td>${escape(r.sucursal||'Sin sucursal')}</td><td>${escape(r.fecha)}</td><td class="money">${escape(money(r.total))}</td><td class="${Number(r.anulada)?'cancelled':''}">${Number(r.anulada)?'Anulada':'Confirmada'}</td><td><button data-invoice="${i}" type="button">Abrir</button></td></tr>`}).join(''));
      message(rows.length?'Boletas consultadas en SQL.': 'No hay boletas para esos filtros.');
    }catch(error){if(request===sequence&&!overlay.hidden){moreError=append;message(controller.signal.aborted?'La consulta no respondió a tiempo. Volvé a consultar.':error.message,true)}}
    finally{if(request===sequence){listLoading=false;pager()}}
  }
  function receiptLayout(result,row){
    const h=result.comprobante,items=result.articulos||[],values=result.valores||[];
    const field=(label,value,width=90,style='')=>`<label class="receipt-field">${escape(label)}<span style="width:${width}px" class="${style}" title="${escape(value??'—')}">${escape(value??'—')}</span></label>`;
    const check=(label,value)=>`<label class="receipt-field">${escape(label)}${value==null?'—':`<input type="checkbox" disabled ${Number(value)?'checked':''}>`}</label>`;
    const dateTime=value=>{
      if(!value)return '—';
      const text=String(value),dotNet=text.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
      const parsed=new Date(dotNet?Number(dotNet[1]):text);
      if(Number.isNaN(parsed.getTime()))return '—';
      return parsed.toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    };
    const date=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
    const point=(historyConfig?.puntosVenta||[]).find(p=>Number(p.id)===Number(h.idPuntoVenta));
    const seller=(historyConfig?.vendedores||[]).find(v=>Number(v.id)===Number(h.vendedor));
    const type=(historyConfig?.comprobantes||[]).find(t=>Number(t.id)===Number(h.idComprobante));
    const taxName=({1:'Resp. inscripto',2:'Resp. no inscripto',3:'No responsable',4:'Exento',5:'Consumidor final',6:'Monotributista'})[Number(h.idTipoIva)]||'—';
    const taxReady=items.every(a=>a.iva!=null),net={21:0,10.5:0},vat={21:0,10.5:0};let allNet=0,allVat=0,untaxed=0;
    items.forEach(a=>{const rate=Number(a.iva)||0,amount=Number(a.importe)||0,base=amount/(1+rate/100),tax=amount-base;allNet+=base;allVat+=tax;if(!rate)untaxed+=amount;if(rate in net){net[rate]+=base;vat[rate]+=tax}});
    const taxMoney=value=>taxReady?money(value):'—';
    const totalValues=values.reduce((sum,v)=>sum+Number(v.total||0),0),adjustment=values.reduce((sum,v)=>sum+Number(v.impRec||0),0);
    const paidCash=()=>money(values.filter(v=>/^efectivo$/i.test(v.tipo||'')).reduce((sum,v)=>sum+Number(v.total||0),0));
    const blank=(count,cols)=>Array.from({length:Math.max(0,count)},()=>`<tr class="receipt-empty">${'<td></td>'.repeat(cols)}</tr>`).join('');
    return `<div class="receipt-layout">
      <div class="receipt-row">${field('P. Vta.:',point?.nombre||h.idPuntoVenta,130)}${field('P.V.:',h.idPuntoVenta,32)}${field('Tipo Comp.:',type?.codigo||row.tipo,65)}${field('Nº:',h.numero,115,'receipt-number')}${field('Fecha:',date(h.fechaComprobante),86)}${field('Vend.:',seller?.nombre||h.vendedor,105)}${field('IDOper:',h.operador,40)}${field('IDCaja:',h.IDCaja,55)}${check('Completo:',h.Completo??h.confirmado)}</div>
      <div class="receipt-row">${field('Cliente:',h.idCliente,55)}${field('',String(h.cliente||'').toUpperCase(),245,'receipt-highlight')}${field('Tel.:',h.telefono||'',95)}${field('IVA:',taxName,120)}${field('Email:',h.email||h.Email||'',160)}${check('Anulada:',h.anulada)}${check('Actualiza Stock:',h.stockActualizado)}${check('En Inf. Vtas.:',h.EnInfVtas)}</div>
      <div class="receipt-row">${field('Tipo Doc.:',Number(h.idTipoDoc)===80?'CUIT':Number(h.idTipoDoc)===96?'DNI':h.idTipoDoc,50)}${field('Nº:',h.documento||'',120)}${field('Moneda:',Number(h.IDMoneda)===1?'Pesos':h.IDMoneda,75)}${field('Cotización:',h.ImpCotiz==null?'—':money(h.ImpCotiz),70)}${field('Nº Fac. N.C.:',h.facturaAsociada||'',105)}${field('Nº Ord. Cpra.:',h.NroOrdCpra||'',90)}${field('Nº Rem./Fac.:',h.IDRemito||'',90)}${field('1er. Vto.:',date(h.vencimiento),86)}</div>
      <div class="receipt-grid receipt-articles"><div class="receipt-articles-scroll"><table class="invoice-history-table"><colgroup><col style="width:38%"><col style="width:7%"><col style="width:7%"><col style="width:10%"><col style="width:10%"><col style="width:7%"><col style="width:7%"><col style="width:14%"></colgroup><thead><tr><th>Descripción</th><th>IDArt</th><th class="money">Cantidad</th><th class="money">PrecioUni</th><th class="money">ImpIVA1</th><th class="money">% IVA</th><th class="money">% Dto.</th><th class="money">Importe</th></tr></thead><tbody>${items.map((a,i)=>`<tr data-warranty-article="${i}"><td title="${escape(a.descripcion)}">${escape(a.descripcion)}</td><td>${escape(a.idart)}</td><td class="money">${number(a.cantidad)}</td><td class="money">${money(a.precio)}</td><td class="money">${a.iva==null?'—':money(Number(a.importe)-Number(a.importe)/(1+Number(a.iva)/100))}</td><td class="money">${a.iva==null?'—':number(a.iva)+'%'}</td><td class="money">${a.descuento==null?'—':number(a.descuento)+'%'}</td><td class="money">${money(a.importe)}</td></tr>`).join('')}${blank(7-items.length,8)}</tbody></table></div><div class="receipt-records">Registro: ${items.length?'1':'0'} de ${items.length}</div></div>
      <div class="receipt-values-area">${canEditValues()?editableValuesTable(values):`<div class="receipt-grid"><div class="receipt-values-scroll"><table class="invoice-history-table"><colgroup><col style="width:15%"><col style="width:15%"><col style="width:14%"><col style="width:7%"><col style="width:10%"><col style="width:12%"><col style="width:15%"><col style="width:12%"></colgroup><thead><tr><th>Tipo de Valor</th><th class="money">Importe</th><th>Tarjeta</th><th>Cuotas</th><th class="money">% D/R</th><th class="money">$ Rec/Dto</th><th class="money">ImpEnt</th><th>Fecha Vto.</th></tr></thead><tbody>${values.map((v,i)=>`<tr><td>${valueCells(v,i)[0]}</td><td class="money">${money(v.importe)}</td><td title="${escape(v.descripcion||'')}">${valueCells(v,i)[1]}</td><td>${valueCells(v,i)[2]}</td><td class="money">${number(Number(v.coef||0)*100)}%</td><td class="money">${money(v.impRec)}</td><td class="money">${money(v.total)}</td><td>${date(v.fechaVto||h.vencimiento)}</td></tr>`).join('')}${blank(2-values.length,8)}</tbody></table></div><div class="receipt-records">Registro: ${values.length?'1':'0'} de ${values.length}</div></div>`}<div class="receipt-tax-summary">${field('Neto 21%:',h.neto21==null?taxMoney(net[21]):money(h.neto21),115)}${field('IVA 21%:',h.iva21==null?taxMoney(vat[21]):money(h.iva21),115)}${field('Neto 10,5%:',h.neto105==null?taxMoney(net[10.5]):money(h.neto105),115)}${field('IVA 10,5%:',h.iva105==null?taxMoney(vat[10.5]):money(h.iva105),115)}</div></div>
      <div class="receipt-row receipt-totals">${field('Dto./Rec.:',money(adjustment),90)}${field('Total Valores:',money(totalValues),105,'receipt-total')}${field('CAE:',h.cae||'',105)}${field('Fecha y Hora:',dateTime(h.fechaHora),160)}${field('Tickets:',h.Tikets??h.Tickets,40)}${field('ID Rem./Fac.:',h.IDRemito,80)}</div>
      <div class="receipt-row receipt-totals">${field('S.T. s/Dto:',h.subtotalSinDto==null?taxMoney(allNet):money(h.subtotalSinDto),100)}${field('Gravado:',h.gravado==null?taxMoney(allNet-untaxed):money(h.gravado),100)}${field('$ IVA:',h.importeIva==null?taxMoney(allVat):money(h.importeIva),95)}${field('Imp. Int.:',h.ImpInt==null?'—':money(h.ImpInt),70)}${field('No Grav.:',taxMoney(untaxed),80)}${field('Total:',money(h.total),110,'receipt-total')}${field('Total ME:',money(h.totalAbsoluto),110,'receipt-total')}</div>
      <div class="receipt-row receipt-totals">${field('Formato impresión:',h.FormatoImp||'Ticket',150)}${field('Nota:',h.nota||'',300)}${field('Efectivo:',h.efectivo==null?paidCash():money(h.efectivo),80)}${field('Tarjeta:',money(h.tarjeta??values.filter(v=>Number(v.clase)===5).reduce((sum,v)=>sum+Number(v.total||0),0)),80)}${field('Cta. Cte.:',money(h.cuentaCorriente??values.filter(v=>/cta|cuenta corriente/i.test(v.tipo||'')).reduce((sum,v)=>sum+Number(v.total||0),0)),80)}${field('Cheque:',money(h.cheque??values.filter(v=>[2,3].includes(Number(v.clase))).reduce((sum,v)=>sum+Number(v.total||0),0)),80)}</div>
      <div class="receipt-actions">${canEditValues()?'<button type="button" data-save-values>Guardar valores</button>':''}</div></div>`;
  }
  async function openDetail(index){
    annulButton.hidden=!isAdministrator();annulButton.disabled=true;
    const row=rows[index];if(!row||actionBusy)return;reviewLinkButton.hidden=!reviewSelection;reviewLinkButton.disabled=true;if(reviewSelection)detailOptions={...detailOptions,readOnly:true};warrantyMenu.hidden=true;detailData=null;detailIndex=index;detail.querySelector('[data-preview]').disabled=true;detail.querySelector('[data-reprint]').disabled=true;detail.querySelector('[data-recall]').disabled=true;detail.querySelector('[data-action-status]').textContent='';detail.hidden=false;detailController?.abort();const controller=detailController=new AbortController(),request=++detailSequence;
    detail.querySelector('[data-title]').textContent='Boleta '+row.numero+(row.tipo?' · '+row.tipo:'');detail.querySelector('[data-detail-position]').textContent=`${index+1} de ${rows.length}`;detail.querySelector('[data-detail-prev]').disabled=index===0;detail.querySelector('[data-detail-next]').disabled=index===rows.length-1;
    if(sectionActive){
      sectionHost.appendChild(detail);sectionHost.dataset.detailOpen='true';
      detail.removeAttribute('aria-modal');detail.setAttribute('role','region');
      detail.querySelector('[data-detail-close]').textContent='Volver a consultar';
      notifyDetailSection(true);
    }
    const body=detail.querySelector('[data-detail-body]');const footer=detail.querySelector('.invoice-history-footer');if(footer&&body.contains(footer))detail.querySelector('.invoice-history-card').appendChild(footer);body.textContent='Consultando detalle…';
    try{const result=await sql('comprobante?id='+encodeURIComponent(row.idRecibo),controller);if(request!==detailSequence||detail.hidden)return;const h=result.comprobante;detailData=result;receiptValuesBasis(result);const unavailable=!Number(h.confirmado)||Number(h.anulada)!==0;reviewLinkButton.hidden=!reviewSelection;reviewLinkButton.disabled=unavailable;const adapters=historyActions();detail.querySelector('[data-preview]').disabled=unavailable||!adapters.preview;detail.querySelector('[data-reprint]').disabled=unavailable||!adapters.reprint;detail.querySelector('[data-recall]').disabled=!Number(h.confirmado)||!adapters.recall;
      const typeName=h.tipo||(historyConfig?.comprobantes||[]).find(t=>Number(t.id)===Number(h.idComprobante))?.nombre||row.tipo;
      detail.querySelector('[data-title]').textContent='Boleta '+h.numero+(typeName?' · '+typeName:'');
      if(sectionActive)notifyDetailSection(true);
      detail.querySelector('[data-preview]').hidden=!adapters.preview;detail.querySelector('[data-reprint]').hidden=!adapters.reprint;detail.querySelector('[data-recall]').hidden=Boolean(reviewSelection)||!adapters.recall;
      detail.querySelector('.invoice-history-footer').style.display=adapters.preview||adapters.reprint||adapters.recall||canEditValues()||isAdministrator()||reviewSelection?'':'none';
      body.innerHTML=receiptLayout(result,row);decorateReceiptDetail(body);
      body.querySelector('.receipt-actions').appendChild(detail.querySelector('.invoice-history-footer'));refreshValueOutputs();
    }catch(error){if(request===detailSequence&&!detail.hidden)body.textContent=controller.signal.aborted?'La consulta no respondió a tiempo. Volvé a abrir la boleta.':error.message}
  }
  async function detailAction(action){
    const row=rows[detailIndex];if(!row||actionBusy)return;const adapter=historyActions()[action],status=detail.querySelector('[data-action-status]');
    if(detailData?.valuesDirty){status.textContent='Guardá los valores antes de ver, reimprimir o llamar la boleta.';return;}
    if(!adapter){status.textContent='Facturación todavía está cargando. Reintentá en unos segundos.';return}
    actionBusy=true;detail.querySelector('[data-preview]').disabled=true;detail.querySelector('[data-reprint]').disabled=true;detail.querySelector('[data-recall]').disabled=true;status.textContent=action==='preview'?'Preparando vista previa…':action==='reprint'?'Preparando reimpresión…':'Cargando boleta en Facturación…';
    let closeAfterAction=false;
    try{const result=await adapter(Number(row.idRecibo));if(result?.cancelled){status.textContent='Carga cancelada.';}else if(action==='recall'||result?.preview)closeAfterAction=true;else status.textContent='Ticket enviado a la impresora.'}
    catch(error){status.textContent=error.message}
    finally{actionBusy=false;if(!detail.hidden){detail.querySelector('[data-preview]').disabled=!Number(detailData?.comprobante?.confirmado)||Boolean(Number(detailData?.comprobante?.anulada))||!historyActions().preview;detail.querySelector('[data-reprint]').disabled=!Number(detailData?.comprobante?.confirmado)||Boolean(Number(detailData?.comprobante?.anulada))||!historyActions().reprint;detail.querySelector('[data-recall]').disabled=!Number(detailData?.comprobante?.confirmado)||!historyActions().recall}if(closeAfterAction)close();}
  }
  detail.querySelector('[data-preview]').addEventListener('click',()=>detailAction('preview'));
  detail.querySelector('[data-reprint]').addEventListener('click',()=>detailAction('reprint'));
  detail.querySelector('[data-recall]').addEventListener('click',()=>detailAction('recall'));
  annulButton.addEventListener('click',async()=>{
    if(actionBusy||!isAdministrator()||annulButton.disabled||!detailData)return;
    const row=rows[detailIndex],index=detailIndex,version=detailData.versionAnulacion;
    if(!confirm(`¿Estás seguro de anular el comprobante ${row.numero}? Se revertirá el stock y se pondrán en cero sus totales, igual que en Access.`))return;
    if(!confirm(`Confirmación final: ANULAR ${row.numero}\nCliente: ${detailData.comprobante.cliente||row.cliente||'—'}\nTotal: ${money(detailData.comprobante.total)}\n\n¿Confirmás la anulación?`))return;
    actionBusy=true;cancellationBusy=true;refreshAnnulButton();
    const states=[...detail.querySelectorAll('button,input,select')].map(control=>[control,control.disabled]);
    states.forEach(([control])=>control.disabled=true);
    const notice=detail.querySelector('[data-action-status]');notice.textContent='Anulando boleta y revirtiendo el stock…';
    window.CorralonSystem?.articleSync?.set('syncing','Anulando boleta y revirtiendo el stock…');
    try{
      const payload={usuarioId:valuesUser().id,idRecibo:row.idRecibo,version};
      if(detailOptions.cancelInvoice)await detailOptions.cancelInvoice(payload);
      else {
        const response=await fetch('/api/facturacion/comprobante-anular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo confirmar la anulación. Volvé a consultar la boleta antes de reintentar.');
      }
      row.anulada=-1;row.total=0;
      const listRow=get('[data-rows]').querySelector(`[data-invoice="${index}"]`);
      if(listRow){listRow.children[5].textContent=money(0);listRow.children[6].textContent='Anulada';listRow.children[6].classList.add('cancelled');}
      actionBusy=false;await openDetail(index);
      detail.querySelector('[data-action-status]').textContent='Boleta anulada en SQL.';
      window.CorralonSystem?.articleSync?.set('success','Boleta anulada en SQL');
      window.CorralonInvoiceHistoryActions?.refreshAfterAnnul?.(row.idRecibo)?.catch(console.warn);
    }catch(error){notice.textContent=error.message;window.CorralonSystem?.articleSync?.set('error',error.message);}
    finally{
      actionBusy=false;cancellationBusy=false;states.forEach(([control,disabled])=>control.disabled=disabled);refreshAnnulButton();
      const unavailable=!Number(detailData?.comprobante?.confirmado)||Boolean(Number(detailData?.comprobante?.anulada))||Boolean(detailData?.valuesDirty);
      detail.querySelector('[data-preview]').disabled=unavailable||!historyActions().preview;
      detail.querySelector('[data-reprint]').disabled=unavailable||!historyActions().reprint;
    }
  });
  function closeDetail(){if(cancellationBusy)return;const wasOpen=!detail.hidden;if(sectionHost?.dataset.detailOpen==='true')notifyDetailSection(false);warrantyMenu.hidden=true;detailData=null;detail.hidden=true;detailSequence++;detailController?.abort();const body=detail.querySelector('[data-detail-body]'),footer=detail.querySelector('.invoice-history-footer');if(footer&&body.contains(footer))detail.querySelector('.invoice-history-card').appendChild(footer);body.textContent='';if(overlay.hidden)returnFocus?.focus();else get('[data-rows]').querySelector(`[data-invoice="${detailIndex}"]`)?.focus();if(wasOpen)detailOptions.onClose?.();}
  let sectionActive=false,sectionExit=null,sectionHost=null;
  function notifyDetailSection(active){
    if(!sectionHost)return;
    sectionHost.dataset.detailOpen=String(active);
    window.dispatchEvent(new CustomEvent('invoice-detail-section',{detail:{active,title:detail.querySelector('[data-title]').textContent,
      controls:[...detail.querySelector('.invoice-history-head').children].filter(node=>!node.matches('h2'))}}));
  }
  function close(){if(sectionActive){if(actionBusy||cancellationBusy||detailData?.valuesDirty){message('Guardá los cambios antes de salir.',true);return;}sectionExit?.();return;}clearTimeout(searchTimer);closeDetail();overlay.hidden=true;sequence++;listController?.abort();rows=[];listLoading=false;hasMore=false;moreError=false;listQuery='';get('[data-rows]').textContent='';button?.focus()}
  window.CorralonInvoiceHistory={
    async selectForReview(options){
      if(!options||typeof options.onSelect!=='function')throw new Error('Falta la revisión para vincular.');
      reviewSelection=options;
      if(window.CorralonInvoiceSections){if(window.CorralonInvoiceSections.show('invoice-consult')===false){reviewSelection=null;throw new Error('No se pudo abrir la consulta.');}}
      else await openList();
    },

    openSection(host,onExit){
      sectionActive=true;sectionExit=onExit;sectionHost=host;
      host.appendChild(overlay);overlay.removeAttribute('aria-modal');overlay.setAttribute('role','region');
      get('[data-close]').textContent='Volver a Facturación';
      return openList();
    },
    canLeaveSection(){return !actionBusy&&!cancellationBusy&&!detailData?.valuesDirty;},
    suspendSection(){
      sectionActive=false;reviewSelection=null;reviewLinkButton.hidden=true;clearTimeout(searchTimer);closeDetail();overlay.hidden=true;
      sequence++;listController?.abort();listLoading=false;
    },
    async openInvoice(id,context=[],options={}){
      id=Number(id);if(!Number.isInteger(id)||id<=0)throw new Error('Seleccioná una factura válida.');
      if(actionBusy)throw new Error('Esperá a que termine la operación actual.');
      detailOptions=options;
      const host=options.host || document.body;
      detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');detail.querySelector('[data-detail-close]').textContent='Cerrar';
      if(detail.parentElement!==host)host.appendChild(detail);
      if(warrantyMenu.parentElement!==host)host.appendChild(warrantyMenu);
      const request=++directOpenSequence;returnFocus=document.activeElement;
      if(!historyConfig)historyConfig=await sql('bootstrap',new AbortController());
      if(request!==directOpenSequence)return;
      listController?.abort();sequence++;overlay.hidden=true;
      rows=context.map(row=>({...row,idRecibo:Number(row.idRecibo??row.id)}));
      let index=rows.findIndex(row=>row.idRecibo===id);
      if(index<0){rows=[{idRecibo:id,numero:''}];index=0;}
      await openDetail(index);detail.querySelector('[data-detail-close]').focus();
    },
    close:closeDetail
  };
  async function openList(){
    if(!overlay.hidden)return;detailOptions=reviewSelection?{readOnly:true}:{};get('h2').textContent=reviewSelection?'Consultar boletas · Vincular venta realizada':'Consultar boletas';overlay.hidden=false;get('[data-search]').value='';get('[data-article]').value='';sortField='';sortDirection='';paintSort();page=0;const current=dateText(new Date());get('[data-from]').value=current;get('[data-to]').value=current;get('[data-branch]').innerHTML='<option value="0">Todas las sucursales</option>';
    const selectedPoint=Number(document.getElementById('pos')?.value)||0;
    message('Consultando la sucursal del punto de venta…');get('[data-search]').focus();const controller=new AbortController();
    try{const config=await sql('bootstrap',controller);historyConfig=config;if(overlay.hidden)return;get('[data-branch]').innerHTML='<option value="0">Todas las sucursales</option>'+config.sucursales.map(s=>`<option value="${Number(s.id)}">${escape(s.nombre)}</option>`).join('');
      const branch=Number((config.puntosVenta||[]).find(p=>Number(p.id)===selectedPoint)?.idSucursal)||0;
      get('[data-branch]').value=String(branch);get('[data-point]').innerHTML='<option value="0">Todos los puntos de venta</option>'+(config.puntosVenta||[]).map(p=>`<option value="${Number(p.id)}">${escape(p.id)} · ${escape(p.nombre)}</option>`).join('');await load();
    }catch(error){if(!overlay.hidden)message('No se pudieron cargar las sucursales: '+error.message,true)}
  }
  button?.addEventListener('click',()=>window.CorralonInvoiceSections?window.CorralonInvoiceSections.show('invoice-consult'):openList());
  get('form').addEventListener('submit',event=>{event.preventDefault();completeReceiptSearch();load()});get('[data-close]').addEventListener('click',close);get('[data-branch]').addEventListener('change',()=>load());get('[data-point]').addEventListener('change',()=>load());
  for(const selector of ['[data-from]','[data-to]']){const field=get(selector);field.addEventListener('input',()=>field.setCustomValidity(''));field.addEventListener('change',()=>load())}
  for(const selector of ['[data-search]','[data-article]'])get(selector).addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(),350)});
  get('[data-rows]').addEventListener('click',event=>{const row=event.target.closest('[data-invoice]');if(row)openDetail(Number(row.dataset.invoice))});get('[data-rows]').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('tr[data-invoice]')){event.preventDefault();openDetail(Number(event.target.dataset.invoice))}});
  get('form').addEventListener('keydown',event=>{if(event.defaultPrevented)return;const controls=[get('[data-branch]'),get('[data-point]'),get('[data-from]'),get('[data-to]'),get('[data-search]'),get('[data-article]')],index=controls.indexOf(event.target);if(index<0)return;
    if(event.key==='F2'&&event.target.select){event.preventDefault();event.target.select();return}
    if(event.key==='Enter'){event.preventDefault();if(index<controls.length-1){if(event.target.classList.contains('date')&&!dateInput(event.target))return;controls[index+1].focus();controls[index+1].select?.()}else load()}
  });
  function navigateDetail(direction){
    if(detail.hidden||actionBusy||cancellationBusy||!detailData)return;
    const nextIndex=detailIndex+direction;
    if(nextIndex<0||nextIndex>=rows.length)return;
    if(detailData.valuesDirty){detail.querySelector('[data-action-status]').textContent='Guardá los valores antes de cambiar de comprobante.';return;}
    openDetail(nextIndex);
  }
  detail.querySelector('[data-detail-close]').addEventListener('click',closeDetail);
  const previousDetail=detail.querySelector('[data-detail-prev]'),nextDetail=detail.querySelector('[data-detail-next]');
  previousDetail.title='Comprobante anterior (RePág)';previousDetail.setAttribute('aria-keyshortcuts','PageUp');
  nextDetail.title='Comprobante siguiente (AvPág)';nextDetail.setAttribute('aria-keyshortcuts','PageDown');
  previousDetail.addEventListener('click',()=>navigateDetail(-1));nextDetail.addEventListener('click',()=>navigateDetail(1));
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||!['PageDown','PageUp'].includes(event.key)||detail.hidden)return;
    if(!warrantyMenu.hidden||[...document.querySelectorAll('dialog[open],.modal-wrap.open')].some(modal=>!detail.contains(modal)))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.repeat)return;
    navigateDetail(event.key==='PageDown'?1:-1);
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!warrantyMenu.hidden){event.preventDefault();warrantyMenu.hidden=true;}else if(event.key==='Escape'&&!detail.hidden){event.preventDefault();closeDetail()}else if(event.key==='Escape'&&!overlay.hidden){event.preventDefault();close()}});
})();

