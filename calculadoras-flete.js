(function () {
  'use strict';
  const FX = window.CorralonFunciones, cache = window.CorralonCacheDB;
  const key = 'calculadoras_flete_remote_v1', collection = 'calculadorasFletes';
  const config = {apiKey:'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',authDomain:'corralon-progreso.firebaseapp.com',projectId:'corralon-progreso',storageBucket:'corralon-progreso.firebasestorage.app',messagingSenderId:'466583614632',appId:'1:466583614632:web:42cb839f83e97475fabe9d'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  let records = new Map(), cursor = null, chain = Promise.resolve(), ready, unsubscribe, db, pending = null, saving = false, connected = false;
  let choosingProvider = false, editingMovement = null, historyRows = [];
  let sortKey = 'date', sortDirection = 'desc';
  const combo = (id,label) => `<label for="${id}">${label}</label><span class="freight-combo"><input id="${id}" autocomplete="off" data-freight-combo role="combobox" aria-autocomplete="list" aria-expanded="false"><button type="button" data-freight-drop tabindex="-1" aria-label="Desplegar ${label}">▾</button><span class="freight-options" role="listbox" hidden></span></span>`;
  const host = document.createElement('div');
  host.innerHTML = `<dialog id="freightSaveDialog" class="freight-dialog"><form id="freightSaveForm"><header><strong>Guardar flete</strong><button type="button" data-freight-close>Cerrar ×</button></header><div class="freight-body"><div class="freight-fields">${combo('freightProvider','Proveedor')}${combo('freightCarrier','Proveedor de transporte')}</div><p id="freightSaveAmounts"></p><div id="freightSaveAverage"></div><p id="freightSaveStatus" role="status"></p></div><footer><button type="button" id="freightSaveConsult">Consultar</button><button type="submit" id="freightConfirm">Guardar</button></footer></form></dialog>
  <dialog id="freightHistoryDialog" class="freight-dialog freight-history"><header><strong>Movimientos de flete</strong><button type="button" data-freight-close>Cerrar ×</button></header><div class="freight-body"><label for="freightMonth">Mes</label><input type="month" id="freightMonth"><p id="freightHistoryStatus" role="status"></p><div class="freight-table-wrap"><table id="freightTable"><thead><tr>${[['date','Fecha'],['providerName','Proveedor'],['carrierName','Proveedor de transporte'],['invoice','Factura'],['freight','Flete'],['percent','% flete']].map(([k,l])=>`<th data-sort-key="${k}">${l}</th>`).join('')}</tr></thead><tbody></tbody></table></div><div id="freightCompanyTotals"></div></div></dialog>`;
  document.body.append(host);
  const el = id => document.getElementById(id), saveDialog = el('freightSaveDialog'), historyDialog = el('freightHistoryDialog');
  el('freightMonth').value = today().slice(0,7);
  const companies = () => [...records.values()].filter(r=>r.kind==='company');
  const movements = () => {
    const result = new Map([...records.values()].filter(r=>r.kind==='movement').map(r=>[r.id,{...r}]));
    [...records.values()].filter(r=>r.kind==='movement-edit').sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0)||(a.createdAt?.nanoseconds||0)-(b.createdAt?.nanoseconds||0)||String(a.id).localeCompare(String(b.id))).forEach(edit=>{
      const row=result.get(edit.movementId);
      if(row)Object.assign(row,{providerId:edit.providerId,providerName:edit.providerName,carrierId:edit.carrierId,carrierName:edit.carrierName});
    });
    return [...result.values()];
  };
  const average = rows => { const invoice=rows.reduce((s,r)=>s+Number(r.invoice),0), freight=rows.reduce((s,r)=>s+Number(r.freight),0); return invoice ? freight/invoice : 0; };
  function summary() {
    const month = today().slice(0,7), rows = movements().filter(r=>r.date.startsWith(month));
    el('freightMonthlySummary').textContent = `Promedio del mes: ${fmtPct(average(rows))} · ${rows.length} movimientos`;
    const provider = resolveProvider(el('freightProvider').value), companyName = norm(resolveProvider(el('freightCarrier').value)?.proveedor || el('freightCarrier').value);
    const selected = rows.filter(r=>(!provider || r.providerId===String(provider.id_proveedor)) && (!companyName || norm(r.carrierName)===companyName));
    el('freightSaveAverage').textContent = `Promedio mensual de esta selección: ${fmtPct(average(selected))} · ${selected.length} movimientos. Calculado sobre el total de facturas y fletes.`;
    renderHistory();
  }
  function renderHistory() {
    const rows = movements().filter(r=>r.date.startsWith(el('freightMonth').value)).sort((a,b)=> {
      const comparison = typeof a[sortKey]==='number' ? a[sortKey]-b[sortKey] : String(a[sortKey]).localeCompare(String(b[sortKey]),'es');
      return sortDirection==='desc' ? -comparison : comparison;
    });
    historyRows=rows;
    el('freightTable').querySelector('tbody').innerHTML = rows.map((r,i)=>`<tr>${[r.date.split('-').reverse().join('/'),r.providerName,r.carrierName,fmtMoney(r.invoice),fmtMoney(r.freight),fmtPct(r.percent)].map((v,j)=>`<td tabindex="0" data-row="${i}" data-col="${j}">${j===1||j===2?`<button type="button" data-edit-freight="${i}" data-edit-field="${j}" title="Cambiar proveedor" style="font:inherit;color:inherit;background:transparent;border:0;padding:0;text-align:left;cursor:pointer">${esc(v)} ✎</button>`:esc(v)}</td>`).join('')}</tr>`).join('');
    const grouped = new Map();
    rows.forEach(r=>{ const list=grouped.get(r.carrierId)||[]; list.push(r); grouped.set(r.carrierId,list); });
    el('freightCompanyTotals').innerHTML = `<strong>${rows.length} movimientos · Promedio mensual: ${esc(fmtPct(average(rows)))}</strong><table><thead><tr><th>Proveedor de transporte</th><th>Movimientos</th><th>Total facturas</th><th>Total flete</th><th>% flete</th></tr></thead><tbody>${[...grouped.values()].map(list=>`<tr><td>${esc(list[0].carrierName)}</td><td>${list.length}</td><td>${esc(fmtMoney(list.reduce((s,r)=>s+r.invoice,0)))}</td><td>${esc(fmtMoney(list.reduce((s,r)=>s+r.freight,0)))}</td><td>${esc(fmtPct(average(list)))}</td></tr>`).join('')}</tbody></table><small>Porcentaje ponderado: total de flete ÷ total de facturas × 100.</small>`;
    el('freightHistoryStatus').textContent = connected ? 'Actualizado desde Firebase' : 'Copia local · esperando conexión a Firebase';
  }
  function resolveProvider(value) { return CorralonSystem.providerIdentity.resolveText(providerState.rows,value); }
  function mergeSnapshot(snapshot) {
    // Only committed server data may advance the cursor or enter the remote cache.
    if (snapshot.metadata.fromCache) return;
    snapshot.docChanges().forEach(change=>{
      if(change.type==='removed' || change.doc.metadata.hasPendingWrites) return;
      const data=change.doc.data(), stamp=data.createdAt;
      if(!stamp) return;
      records.set(change.doc.id,{...data,id:change.doc.id,createdAt:{seconds:stamp.seconds,nanoseconds:stamp.nanoseconds}});
      if(!cursor || stamp.seconds>cursor.seconds || (stamp.seconds===cursor.seconds && stamp.nanoseconds>cursor.nanoseconds)) cursor={seconds:stamp.seconds,nanoseconds:stamp.nanoseconds};
    });
    connected=true;
    summary();
    // Rows and cursor are one atomic IndexedDB entry; never upload this cache.
    return cache.set(key,{records:[...records.values()],cursor});
  }
  async function start() {
    const cached=await cache.get(key);
    if(cached) { records=new Map((cached.records||[]).map(r=>[r.id,r])); cursor=cached.cursor||null; }
    summary();
    if(!firebase.apps.length) firebase.initializeApp(config);
    db=firebase.firestore();
    let query=db.collection(collection).orderBy('createdAt','asc');
    // Inclusive boundary preserves documents that share the last server timestamp.
    if(cursor) query=query.where('createdAt','>=',new firebase.firestore.Timestamp(cursor.seconds,cursor.nanoseconds));
    unsubscribe=query.onSnapshot({includeMetadataChanges:true}, snapshot=>{
      chain=chain.then(()=>mergeSnapshot(snapshot)).catch(error=>{el('freightSaveStatus').textContent=`No se pudo guardar la copia local: ${error.message}`;});
    },error=>{connected=false; summary(); el('freightSaveStatus').textContent=`No se pudo sincronizar Firebase: ${error.message}`;});
  }
  ready=start().catch(error=>{el('freightMonthlySummary').textContent=`No se pudo iniciar la consulta: ${error.message}`; throw error;});
  ready.catch(()=>{});
  async function companyId(name) {
    if(name.length>120)throw new Error('El nombre de la empresa admite hasta 120 caracteres');
    // Deterministic UTF-8 ID also works on LAN HTTP, where crypto.subtle is unavailable.
    return 'company_'+[...new TextEncoder().encode(norm(name))].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function createCompany(name) {
    await ready;
    const id=await companyId(name), ref=db.collection(collection).doc(id);
    await db.runTransaction(async tx=>{const existing=await tx.get(ref); if(!existing.exists) tx.set(ref,{kind:'company',name:name.trim(),createdAt:firebase.firestore.FieldValue.serverTimestamp()});});
    return id;
  }
  function createFreightProvider(input) {
    const name=input.value.trim();
    if (!name) { el('freightSaveStatus').textContent='Escribí el nombre del proveedor.'; input.focus(); return; }
    if (resolveProvider(name)) { el('freightSaveStatus').textContent='Ese proveedor ya existe. Seleccionalo en la lista.'; return; }
    if (!confirm(`El proveedor "${name}" no existe. ¿Querés cargarlo?`)) return;
    const pendingBefore=pending;
    choosingProvider=true;
    saveDialog.close();
    pending=pendingBefore;
    providerState.onClosed=()=>{choosingProvider=false;pending=pendingBefore;saveDialog.showModal();input.focus();};
    providerState.onSaved=provider=>{
      input.value=providerDisplay(provider);
      closeProviderModal(); summary();
    };
    openProviderModal({id_proveedor:CorralonSystem.providerIdentity.newId(),codigo_proveedor:'',proveedor:name});
    setProviderModalEditing(true);
    document.getElementById('modalProviderId').value='';
    document.getElementById('modalProviderId').focus();
  }
  el('saveFreightBtn').onclick=()=>{
    editingMovement=null;saveDialog.querySelector('header strong').textContent='Guardar flete';
    const invoice=n('totalFactura'), freight=n('totalFlete');
    if(invoice<=0 || freight<0 || !Number.isFinite(invoice+freight)) {alert('Ingresá un total de factura mayor a cero y un flete válido.'); return;}
    if(!pending) pending={id:[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join(''),invoice,freight,date:today()};
    el('freightSaveAmounts').textContent=`Factura: ${fmtMoney(pending.invoice)} · Flete: ${fmtMoney(pending.freight)} · ${fmtPct(pending.freight/pending.invoice)}`;
    el('freightProvider').value=providerInput.value;
    el('freightSaveStatus').textContent=''; summary(); saveDialog.showModal(); el('freightProvider').focus();
  };
  el('freightSaveForm').onsubmit=async event=>{
    event.preventDefault(); if(saving || !pending) return;
    const provider=resolveProvider(el('freightProvider').value), carrier=resolveProvider(el('freightCarrier').value), name=carrier?.proveedor||'';
    if(!provider || !carrier) {el('freightSaveStatus').textContent='Seleccioná el proveedor de la factura y el proveedor de transporte.'; return;}
    saving=true; el('freightConfirm').disabled=true;
    try {
      await ready;
      if(editingMovement){
        const ref=db.collection(collection).doc('edit_'+pending.id);
        const payload={kind:'movement-edit',movementId:editingMovement.id,providerId:String(provider.id_proveedor),providerName:provider.proveedor,carrierId:await companyId(name),carrierName:name};
        await db.runTransaction(async tx=>{const existing=await tx.get(ref);if(!existing.exists)tx.set(ref,{...payload,createdAt:firebase.firestore.FieldValue.serverTimestamp()});});
        // The original amounts and history remain intact; the shared listener receives the correction.
        saveDialog.close();return;
      }
      // Stable operation ID makes uncertain connection retries idempotent. Existing data is never replaced.
      const carrierId=await companyId(name), ref=db.collection(collection).doc('movement_'+pending.id), carrierRef=db.collection(collection).doc(carrierId);
      const payload={kind:'movement',date:pending.date,invoice:pending.invoice,freight:pending.freight,percent:pending.freight/pending.invoice,providerId:String(provider.id_proveedor),providerName:provider.proveedor,carrierId,carrierName:name};
      await db.runTransaction(async tx=>{
        const [existing,company]=await Promise.all([tx.get(ref),tx.get(carrierRef)]);
        if(existing.exists) return;
        if(!company.exists) tx.set(carrierRef,{kind:'company',name,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        tx.set(ref,{...payload,carrierName:company.exists?company.data().name:name,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      });
      pending=null; saveDialog.close();
      el('freightMonthlySummary').textContent='Flete guardado en Firebase.';
    } catch(error) {el('freightSaveStatus').textContent=`No se pudo confirmar el guardado: ${error.message}. Podés reintentar sin duplicar.`;}
    finally {saving=false; el('freightConfirm').disabled=false;}
  };
  el('freightTable').addEventListener('click',event=>{
    const button=event.target.closest('[data-edit-freight]');if(!button||saving)return;
    const row=historyRows[Number(button.dataset.editFreight)];if(!row)return;
    editingMovement={...row};
    pending={id:[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join(''),invoice:row.invoice,freight:row.freight,date:row.date};
    const provider=providerState.rows.find(p=>String(p.id_proveedor)===String(row.providerId))||resolveProvider(row.providerName);
    const carrier=resolveProvider(row.carrierName);
    el('freightProvider').value=provider?providerDisplay(provider):row.providerName;
    el('freightCarrier').value=carrier?providerDisplay(carrier):row.carrierName;
    saveDialog.querySelector('header strong').textContent='Editar proveedores del flete';
    el('freightSaveAmounts').textContent=`Factura: ${fmtMoney(row.invoice)} · Flete: ${fmtMoney(row.freight)} · ${fmtPct(row.percent)}`;
    el('freightSaveStatus').textContent='';
    historyDialog.close();saveDialog.showModal();
    el(button.dataset.editField==='2'?'freightCarrier':'freightProvider').focus();
  });
  function openHistory() {summary(); historyDialog.showModal();}
  el('consultFreightBtn').onclick=openHistory; el('freightSaveConsult').onclick=openHistory;
  el('freightMonth').onchange=renderHistory;
  host.querySelectorAll('[data-freight-close]').forEach(button=>button.onclick=()=>{if(saving)return; button.closest('dialog').close();});
  saveDialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  saveDialog.addEventListener('close',()=>{
    if(choosingProvider)return;
    pending=null;
    if(editingMovement){editingMovement=null;summary();if(!historyDialog.open)historyDialog.showModal();}
    else el('saveFreightBtn').focus();
  });
  let activeCombo=null, options=[], activeIndex=0;
  function hide(input) {input.parentElement.querySelector('.freight-options').hidden=true; input.setAttribute('aria-expanded','false'); if(activeCombo===input)activeCombo=null;}
  function show(input,reason) {
    activeCombo=input; activeIndex=0;
    const all=reason==='button'||reason==='toggle', query=norm(all?'':input.value);
    options=providerState.rows.map(p=>({name:providerDisplay(p),search:`${p.proveedor} ${CorralonSystem.providerIdentity.externalId(p)}`})).filter(r=>norm(r.search).includes(query)).slice(0,80);
    const list=input.parentElement.querySelector('.freight-options');
    list.innerHTML=options.map((r,i)=>`<span role="option" data-freight-option="${i}">${esc(r.name)}</span>`).join('')||'<span>Sin coincidencias</span>';
    list.hidden=false; input.setAttribute('aria-expanded','true'); highlight();
  }
  function highlight() { if(!activeCombo)return; activeCombo.parentElement.querySelectorAll('[data-freight-option]').forEach((r,i)=>{r.classList.toggle('active',i===activeIndex);r.setAttribute('aria-selected',String(i===activeIndex)); if(i===activeIndex)r.scrollIntoView({block:'nearest'});}); }
  function pick(input) {const option=options[activeIndex]; if(!option)return false; input.value=option.name;hide(input);input.dispatchEvent(new Event('change',{bubbles:true}));summary();return true;}
  saveDialog.addEventListener('keydown',event=>{
    const input=event.target.closest('[data-freight-combo]');
    if(event.key!=='Enter'||!input||!input.value.trim()||resolveProvider(input.value))return;
    const matches=providerState.rows.some(p=>norm(`${p.proveedor} ${CorralonSystem.providerIdentity.externalId(p)}`).includes(norm(input.value)));
    if(matches)return;
    event.preventDefault();event.stopImmediatePropagation();hide(input);createFreightProvider(input);
  },true);
  FX.bindDropdownOnlyWhenTyping({root:saveDialog,inputSelector:'[data-freight-combo]',buttonSelector:'[data-freight-drop]',show,hide,isOpen:input=>!input.parentElement.querySelector('.freight-options').hidden,pickActive:pick,moveActive:(_input,delta)=>{activeIndex=Math.max(0,Math.min(options.length-1,activeIndex+delta));highlight();},inputFromButton:button=>button.parentElement.querySelector('input'),selectOnFocus:false,enterPicksFirst:false});
  saveDialog.addEventListener('mousedown',event=>{const option=event.target.closest('[data-freight-option]');if(option){event.preventDefault();activeIndex=Number(option.dataset.freightOption);pick(activeCombo);}});
  saveDialog.addEventListener('focusout',event=>{const input=event.target;if(input.matches('[data-freight-combo]'))setTimeout(()=>{if(!input.parentElement.contains(document.activeElement))hide(input);},0);});
  saveDialog.addEventListener('mousedown',event=>{if(activeCombo && !activeCombo.parentElement.contains(event.target))hide(activeCombo);});
  saveDialog.addEventListener('change',event=>{if(event.target.matches('[data-freight-combo]'))hide(event.target);summary();});
  FX.bindLinearNavigation({root:saveDialog,selector:'input,button:not([data-freight-drop])',navigateLeftRight:true,smartCaret:true,selectOnAnyFocus:true,selectOnFirstPointerFocus:true});
  FX.bindLabelSelect({root:saveDialog,labelSelector:'label',controlSelector:'input'});
  FX.bindFieldRestore({root:saveDialog,selector:'[data-freight-combo]'});
  FX.bindTableSort({root:el('freightTable'),sort:(key,direction)=>{sortKey=key||'date';sortDirection=direction||'desc';renderHistory();}});
  FX.bindTableSelectPaste({root:el('freightTable'),clearOnDelete:false,setCellValue:()=>{}});
  FX.bindGridNavigation({root:el('freightTable'),cellSelector:'td[data-row][data-col]',navigateLeftRight:true});
  // The existing calculator's document-level navigator must not handle modal fields a second time.
  host.addEventListener('keydown',event=>event.stopPropagation());
  window.addEventListener('beforeunload',()=>unsubscribe?.());
})();
