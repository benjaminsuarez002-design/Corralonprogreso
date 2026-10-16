/* Cobranzas is a page section. SQL remains the source of truth; tender/change is local. */
(()=>{
  const section=document.createElement('section');section.id='cajaCobranzas';section.hidden=true;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(value)||0);
  const qty=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:4}).format(Number(value)||0);
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const style=document.createElement('style');style.textContent=`
    #cajaSqlMain[hidden],#cajaCobranzas[hidden]{display:none!important}
    #cajaCobranzas{box-sizing:border-box;min-height:100dvh;padding:14px;background:#eee;color:#181818;font:14px Arial,sans-serif;display:flex;flex-direction:column;gap:12px}
    #cajaCobranzas header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 12px;background:#fff;border:1px solid #ccc;border-radius:7px}
    #cajaCobranzas h1{font-size:22px;margin:0;flex:1}#cajaCobranzas h2{font-size:15px;margin:0;padding:8px;background:#e4e4e4}
    #cajaCobranzas button{padding:8px 14px;border:1px solid #aaa;border-radius:5px;background:#fff;color:#222;font:700 14px Arial;cursor:pointer}
    #cajaCobranzas button:disabled{opacity:.5;cursor:default}#cajaCobranzas select,#cajaCobranzas input{box-sizing:border-box;font:inherit;padding:5px;border:1px solid #aaa;border-radius:3px}
    #cajaCobranzas .cc-layout{display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:14px;flex:1;min-height:0}
    #cajaCobranzas .cc-tables{display:grid;grid-template-rows:minmax(210px,1.2fr) minmax(180px,1fr) minmax(150px,.8fr);gap:12px;min-width:0}
    #cajaCobranzas .cc-panel{border:1px solid #bbb;background:#fff;display:flex;flex-direction:column;min-height:0;overflow:hidden;border-radius:5px}
    #cajaCobranzas .cc-scroll{overflow:auto;flex:1;min-height:0;max-height:32dvh}
    #cajaCobranzas table{border-collapse:collapse;width:100%;white-space:nowrap;font:14px Arial}
    #cajaCobranzas th,#cajaCobranzas td{border:1px solid #d5d5d5;padding:6px 8px;text-align:left}
    #cajaCobranzas th{position:sticky;top:0;background:#e1e4e8;z-index:1}#cajaCobranzas td.num{text-align:right}
    #cajaCobranzas tr[data-cc-id]{background:#e2f2e6;cursor:pointer}#cajaCobranzas tr[data-cc-id]:nth-child(even){background:#f5f5f5}
    #cajaCobranzas tr[aria-selected=true]{background:#acd3e8!important;outline:2px solid #5685a1;outline-offset:-2px}
    #cajaCobranzas [data-cc-tender]{width:125px;background:#fff}#cajaCobranzas aside{display:flex;flex-direction:column;gap:10px}
    #cajaCobranzas .cc-status{min-height:20px;margin:0;color:#555}#cajaCobranzas .cc-status.error{color:#b00020}
    #cajaCobranzas .cc-foot{padding:6px 8px;color:#555;font-size:12px}
    @media(max-width:700px){#cajaCobranzas .cc-layout{grid-template-columns:1fr}#cajaCobranzas aside{flex-direction:row;flex-wrap:wrap}#cajaCobranzas{padding:6px}#cajaCobranzas .cc-scroll{max-height:35dvh}}
  `;document.head.append(style);
  section.innerHTML=`<header><h1>Cobranzas en caja</h1><label>Sucursal <select data-cc-branch><option value="0">Todas las sucursales</option><option value="1">Progreso y Ruta</option><option value="2">Calle 5 y España</option></select></label><span data-cc-date></span><button data-cc-refresh>Actualizar</button><button data-cc-back>Volver a Caja</button></header>
    <p class="cc-status" role="status" aria-live="polite"></p><div class="cc-layout"><div class="cc-tables">
    <div class="cc-panel"><h2>Facturas a cobrar</h2><div class="cc-scroll"><table><thead><tr><th>Tipo Comp</th><th>N.º Comprobante</th><th>Cliente</th><th>Pagada</th><th>Importe</th><th>Paga con</th><th>Vuelto</th><th>Hora</th></tr></thead><tbody data-cc-queue></tbody></table></div><div class="cc-foot" data-cc-count></div></div>
    <div class="cc-panel"><h2>Artículos de la factura</h2><div class="cc-scroll"><table><thead><tr><th>IDArt</th><th>Descripción</th><th>Cant.</th><th>PrecioUni</th><th>Importe</th></tr></thead><tbody data-cc-items></tbody></table></div></div>
    <div class="cc-panel"><h2>Tipo de pago</h2><div class="cc-scroll"><table><thead><tr><th>Tipo de valor</th><th>Importe</th><th>Tarjeta</th><th>Cuotas</th><th>Coef.</th><th>$ Rec/Dto</th><th>ImpEnt</th><th>Fecha Vto.</th><th>Descripción</th></tr></thead><tbody data-cc-values></tbody></table></div></div>
    </div><aside><button id="consultInvoices">Consultar ventas</button><button data-cc-open disabled>Abrir comprobante</button><button data-cc-edit disabled>Editar valores</button><small>La lista se actualiza cada 15 segundos. «Paga con» y «Vuelto» son un cálculo local.</small></aside></div>`;
  document.body.append(section);
  const $=s=>section.querySelector(s);let rows=[],selected=0,detail=null,busy=false,editing=false,sequence=0,options=null,boot=null;const tenders=new Map();
  const request=(action,params={},body=null)=>window.CajaSQL.request(action,{fecha:today(),...params},body?{...body,fecha:today()}:null);
  function status(text,error=false){$('.cc-status').textContent=text;$('.cc-status').classList.toggle('error',error);}
  function controls(){for(const el of section.querySelectorAll('button,select,[data-cc-paid]'))el.disabled=busy||editing||(el.matches('[data-cc-paid]')&&!boot?.editar); $('[data-cc-open]').disabled=busy||editing||!detail;$('[data-cc-edit]').disabled=busy||editing||!detail||!boot?.editar;}
  function clearDetail(){$('[data-cc-items]').textContent='';$('[data-cc-values]').textContent='';detail=null;controls();}
  async function select(id){
    selected=id;const ticket=++sequence;clearDetail();section.querySelectorAll('[data-cc-id]').forEach(r=>r.setAttribute('aria-selected',String(Number(r.dataset.ccId)===id)));
    if(!id)return;
    try{const data=await request('cobranza-detalle',{id});if(ticket!==sequence||section.hidden)return;detail=data;
      $('[data-cc-items]').innerHTML=data.articulos.map(a=>`<tr><td>${esc(a.idart)}</td><td>${esc(a.descripcion)}</td><td class="num">${qty(a.cantidad)}</td><td class="num">${money(a.precio)}</td><td class="num">${money(a.importe)}</td></tr>`).join('');
      $('[data-cc-values]').innerHTML=data.valores.map(v=>`<tr><td>${esc(v.tipo)}</td><td class="num">${money(v.importe)}</td><td>${esc(v.tarjeta||'Ninguna')}</td><td class="num">${qty(v.cuotas)}</td><td class="num">${qty(v.coef)}</td><td class="num">${money(v.impRec)}</td><td class="num">${money(v.total)}</td><td>${esc(v.vencimiento)}</td><td>${esc(v.descripcion)}</td></tr>`).join('');controls();
    }catch(error){if(ticket===sequence)status(error.message,true);}
  }
  function render(){
    $('[data-cc-queue]').innerHTML=rows.map(r=>`<tr data-cc-id="${Number(r.id)}" tabindex="0" aria-selected="${Number(r.id)===selected}"><td>${esc(r.tipo)}</td><td>${esc(r.numero)}</td><td>${esc(r.cliente)}</td><td><input type="checkbox" data-cc-paid aria-label="Marcar ${esc(r.numero)} como pagada" ${boot.editar?'':'disabled'}></td><td class="num">${money(r.total)}</td><td><input data-cc-tender inputmode="decimal" aria-label="Paga con" value="${esc(tenders.get(Number(r.id))||'')}"></td><td class="num" data-cc-change></td><td>${esc(r.hora)}</td></tr>`).join('');
    $('[data-cc-count]').textContent=`${rows.length} comprobantes pendientes`;
    section.querySelectorAll('[data-cc-tender]').forEach(calculate);controls();
  }
  function calculate(input){const tr=input.closest('[data-cc-id]'),row=rows.find(r=>Number(r.id)===Number(tr.dataset.ccId));const text=input.value.trim();const value=Number(text.includes(',')?text.replace(/\./g,'').replace(',','.'):text);tr.querySelector('[data-cc-change]').textContent=text&&Number.isFinite(value)?money(value-Number(row.total)):'';}
  async function refresh(silent=false){
    if(busy||editing||section.hidden)return;busy=true;controls();if(!silent)status('Consultando pendientes de hoy…');
    try{const data=await request('cobranzas',{sucursal:Number($('[data-cc-branch]').value)});if(section.hidden)return;rows=data.filas;const existing=new Set(rows.map(r=>Number(r.id)));for(const id of tenders.keys())if(!existing.has(id))tenders.delete(id);render();await select(existing.has(selected)?selected:Number(rows[0]?.id)||0);status(rows.length?'Pendientes de hoy · Actualización automática cada 15 segundos.':'No hay comprobantes pendientes de hoy.');}
    catch(error){status(error.message,true);}finally{busy=false;controls();}
  }
  async function paid(id,checkbox){
    checkbox.checked=false;if(busy||editing||!boot.editar)return;
    busy=true;controls();
    try{await select(id);if(!detail||detail.idRecibo!==id)throw new Error('Volvé a seleccionar el comprobante.');if(!window.confirm(`¿Marcar como pagada la boleta ${rows.find(r=>Number(r.id)===id)?.numero}?`))return;
      await request('cobranza-pagada',{}, {idRecibo:id,version:detail.version});tenders.delete(id);status('Comprobante marcado como pagado.');
    }catch(error){status(error.message,true);return;}finally{busy=false;controls();}
    await refresh();
  }
  async function openInvoice(edit){if(!detail||busy||editing)return;editing=true;controls();try{
    await window.CorralonInvoiceHistory.openInvoice(selected,rows.map(r=>({idRecibo:r.id,numero:r.numero})),{allowEditValues:edit&&boot.editar,saveValues:async payload=>{await request('cobranza-valores',{},payload);},onClose:()=>{editing=false;controls();refresh();}});
  }catch(error){editing=false;controls();status(error.message,true);}}
  $('[data-cc-queue]').addEventListener('click',e=>{const tr=e.target.closest('[data-cc-id]');if(!tr||busy||editing)return;const id=Number(tr.dataset.ccId);if(e.target.matches('[data-cc-paid]')){paid(id,e.target);return;}if(e.target.matches('input'))return;select(id);});
  $('[data-cc-queue]').addEventListener('keydown',e=>{if(e.target.matches('input')||busy||editing)return;const tr=e.target.closest('[data-cc-id]');if(!tr)return;const index=rows.findIndex(r=>Number(r.id)===Number(tr.dataset.ccId));if(e.key==='Enter'){e.preventDefault();select(Number(tr.dataset.ccId));}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const next=rows[index+(e.key==='ArrowDown'?1:-1)];if(next){select(Number(next.id));section.querySelector(`[data-cc-id="${Number(next.id)}"]`).focus();}}});
  $('[data-cc-queue]').addEventListener('input',e=>{if(e.target.matches('[data-cc-tender]')){tenders.set(Number(e.target.closest('[data-cc-id]').dataset.ccId),e.target.value);calculate(e.target);}});
  $('[data-cc-branch]').onchange=()=>{selected=0;refresh();};$('[data-cc-refresh]').onclick=()=>refresh();$('[data-cc-open]').onclick=()=>openInvoice(false);$('[data-cc-edit]').onclick=()=>openInvoice(true);
  $('[data-cc-back]').onclick=async()=>{if(busy||editing)return;section.hidden=true;++sequence;options.main.hidden=false;await options.onBack();};
  window.CajaCobranzas={async open(config){options=config;boot=await window.CajaSQL.bootstrap();$('[data-cc-branch]').value=String(boot.restringido?boot.sucursal:config.branch||0);$('[data-cc-branch]').hidden=boot.restringido;$('[data-cc-date]').textContent=new Date().toLocaleDateString('es-AR');config.main.hidden=true;section.hidden=false;await refresh();$('[data-cc-back]').focus();}};
  setInterval(()=>{if(!section.hidden&&!document.hidden&&!section.contains(document.activeElement?.closest('input,select'))&&!document.querySelector('.invoice-history-overlay:not([hidden])'))refresh(true);},15000);
})();
