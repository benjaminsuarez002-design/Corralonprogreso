import {enqueue, resumeQueue, recoverDraft, importUnitCost, importDraftKey} from './local-article-sync.js';
export {resumeQueue};

// Loaded by the SQL importer on localhost or Tailscale. No database credentials reach the browser.
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const normalizeIndexFilter = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[-_]/g, ' ')
  .replace(/[^a-z0-9\s]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const compactIndexFilter = value => normalizeIndexFilter(value).replace(/\s+/g, '');
function indexDescriptionFilterRank(description, queryText, prepared) {
  const query = prepared?.query ?? normalizeIndexFilter(queryText);
  if (!query) return 0;
  const text = prepared?.text ?? normalizeIndexFilter(description);
  if (!text) return Number.POSITIVE_INFINITY;
  const compactQuery = prepared?.compactQuery ?? compactIndexFilter(query);
  const compactText = prepared?.compactText ?? compactIndexFilter(text);
  const terms = prepared?.terms ?? query.split(' ').filter(Boolean);
  const words = prepared?.words ?? text.split(' ').filter(Boolean);
  if (text === query) return 0;
  if (compactQuery && compactText === compactQuery) return 1;
  if (text.startsWith(query)) return 2;
  if (` ${text} `.includes(` ${query} `)) return 3;
  if (compactQuery && compactText.includes(compactQuery)) return 4;
  if (terms.every(term => words.some(word => word.startsWith(term)))) return 5;
  if (terms.every(term => words.some(word => word.includes(term)))) return 6;
  return Number.POSITIVE_INFINITY;
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number(value || 0).toLocaleString('es-AR', { style:'currency', currency:'ARS' });
let active = false;
export function hasDraft(providerId) {
  const key=importDraftKey(providerId);
  try { return Boolean(window.localStorage.getItem(key) || window.sessionStorage.getItem(key)); } catch { return false; }
}

async function api(path, options = {}) {
  const response = await fetch(`/api/local-articles/${path}`, { cache:'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No respondió el importador local. Verificá que el servidor esté actualizado.');
  return data;
}

export async function open(options, window = globalThis.window, document = globalThis.document) {
  if (active && document.querySelector('.local-articles-backdrop')) return;
  // Si otra actualización quitó el popup del DOM, no conservar un bloqueo fantasma.
  active = false;
  active = true;
  const returnFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'local-articles-backdrop';
  backdrop.innerHTML = `<section class="local-articles-dialog" role="dialog" aria-modal="true" aria-labelledby="localArticlesTitle">
    <header><div><h2 id="localArticlesTitle">Importar o actualizar artículos</h2><p data-provider></p><p data-original-description hidden></p></div><button type="button" data-close>Cerrar</button></header>
    <div class="local-articles-scroll"><table class="new-articles-table"><colgroup><col style="width:105px"><col style="width:150px"><col><col style="width:155px"><col style="width:75px"><col style="width:92px"><col style="width:112px"><col style="width:112px"><col style="width:85px"><col style="width:130px"></colgroup><thead><tr><th>IDArt</th><th>Cód. proveedor</th><th>Artículo</th><th>Rubro</th><th>IVA</th><th>Margen %</th><th>Costo nuevo</th><th>Precio viejo</th><th title="Diferencia entre el costo nuevo y el precio viejo">Dif. %</th><th></th></tr></thead><tbody></tbody></table></div>
    <div data-status role="status"><span data-status-text>Leyendo artículos de la base local…</span><button type="button" data-reconnect hidden>Restablecer conexión</button></div><footer><span data-summary></span><button type="button" data-cancel>Cancelar</button><button type="button" class="primary" data-apply disabled>Aplicar todos</button></footer>
  </section>`;
  document.body.append(backdrop);
  // La ficha SQL se reutiliza y su diálogo nativo gestiona el foco al abrirse.
  const backgroundElements = [...document.body.children].filter(element => element !== backdrop && element.id !== 'sqlArticlePopup');
  const backgroundInert = backgroundElements.map(element => [element, element.inert]);
  backgroundElements.forEach(element => { element.inert = true; });
  let articleEditor = null;
  const focusInside = () => backdrop.querySelector('input:not([disabled]),select:not([disabled]),button:not([disabled])')?.focus({preventScroll:true});
  const guardFocus = event => {
    if (!backdrop.isConnected || backdrop.inert || articleEditor || backdrop.contains(event.target) || menu?.contains(event.target)) return;
    event.stopImmediatePropagation(); focusInside();
  };
  const guardKeyup = event => { if (backdrop.isConnected && !backdrop.inert && !articleEditor) event.stopImmediatePropagation(); };
  window.addEventListener('focusin', guardFocus, true);
  window.addEventListener('keyup', guardKeyup, true);
  backdrop.querySelector('[data-close]').focus({preventScroll:true});
  const status = backdrop.querySelector('[data-status]'), statusText = backdrop.querySelector('[data-status-text]');
  const originalDescription = backdrop.querySelector('[data-original-description]');
  const reconnect = backdrop.querySelector('[data-reconnect]'), apply = backdrop.querySelector('[data-apply]');
  const providerId = Number(options.provider.id_proveedor || options.provider.idProveedor);
  const draftScope=options.draftScope||'',draftKey=importDraftKey(providerId,draftScope);
  let retainedRows=[];
  let busy = false, rows = [], catalog = [], catalogSorted = [], rubros = [], token = '', operation = (window.CorralonFunciones?.createUuid?.() || crypto.randomUUID());
  let catalogReady = false, draftSaveTimer = 0;
  const draftCache=window.CorralonSystem.localCache;
  let draftWrite=Promise.resolve();
  let menu = null, menuInput = null, menuIndex = -1, menuKind = '', matches = [];
  let articlePage = null, articleHasMatch = false;
  let showSuspended = false;
  let articleContext = null;
  function hideArticleContext() { articleContext?.remove(); articleContext = null; }
  function existingImporterArticles(row) {
    if (!row) return [];
    const id = row.sqlSaved?.id || (row.mode === 'update' ? row.id : '');
    if (id) return [catalog.find(article => String(article.id) === String(id)) || {id}];
    const code = normalize(row.codigo);
    return code ? catalog.filter(article => Number(article.proveedor) === providerId && normalize(article.codigo) === code) : [];
  }
  function openImporterArticleEditor(article) {
    if (busy || articleEditor) return;
    hideArticleContext(); hideMenu(); flushDraft();
    const focus = document.activeElement;
    if(window.CorralonSQLModules?.openArticle){articleEditor=true;window.CorralonSQLModules.openArticle(article.id,{origin:focus,onSaved:async()=>{try{const fresh=await api(`article?id=${encodeURIComponent(article.id)}`);rows.filter(row=>row.mode==='update'&&String(row.id)===String(article.id)).forEach(row=>{row.original=fresh;row.version=fresh.version;});await refreshConnection();changed();render();setStatus('Ficha actualizada. Se conservaron los datos del lote del importador.');}catch(error){setStatus(error.message,true);}},onClose:()=>{articleEditor=null;if(focus?.isConnected)focus.focus({preventScroll:true});}}).then(opened=>{if(opened===false)articleEditor=null;}).catch(error=>{articleEditor=null;setStatus(error.message,true);});return;}
    const popup = document.createElement('dialog'); articleEditor = popup;
    popup.style.cssText = 'width:min(1100px,98vw);height:94dvh;max-width:none;max-height:none;padding:0;border:1px solid #ccc;border-radius:10px;overflow:hidden';
    const frame = document.createElement('iframe'); frame.title = 'Ficha del artículo'; frame.style.cssText = 'width:100%;height:100%;border:0';
    frame.src = `articulos-sql.html?embed=stock&articulo=${encodeURIComponent(article.id)}`;
    popup.append(frame); backdrop.append(popup);
    const receive = async event => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === 'corralon:article-editor-close') popup.close();
      if (event.data?.type === 'corralon:article-editor-saved') {
        try {
          const fresh = await api(`article?id=${encodeURIComponent(article.id)}`);
          rows.filter(row => row.mode === 'update' && String(row.id) === String(article.id)).forEach(row => { row.original = fresh; row.version = fresh.version; });
          await refreshConnection();
          changed(); render(); setStatus('Ficha actualizada. Se conservaron los datos del lote del importador.');
        } catch (error) { setStatus(error.message, true); }
      }
    };
    window.addEventListener('message', receive);
    popup.addEventListener('cancel', event => { event.preventDefault(); frame.contentDocument?.getElementById('closeArticle')?.click(); });
    popup.addEventListener('close', () => { window.removeEventListener('message', receive); popup.remove(); articleEditor = null; if (focus?.isConnected) focus.focus({preventScroll:true}); });
    popup.showModal();
  }
  backdrop.addEventListener('contextmenu', event => {
    const tr = event.target.closest('tr[data-row]');
    if (!tr || busy || articleEditor) return;
    const row = rows[Number(tr.dataset.row)];
    if (!row) return;
    const articles = existingImporterArticles(row);
    event.preventDefault(); event.stopPropagation(); hideMenu(); hideArticleContext();
    articleContext = document.createElement('div'); articleContext.className = 'local-articles-search';
    articleContext.setAttribute('role', 'menu');
    articleContext.style.cssText = `position:fixed;left:${Math.max(8,Math.min(event.clientX,innerWidth-300))}px;top:${Math.max(8,Math.min(event.clientY,innerHeight-200))}px;width:290px;max-height:240px;overflow:auto;z-index:10000;background:white;border:1px solid #bbb;box-shadow:0 4px 12px #0003`;
    articles.forEach(article => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role','menuitem');
      button.textContent = articles.length === 1 ? 'Editar artículo' : `Editar artículo ${article.id} · ${article.descripcion || ''}`;
      button.onclick = event => { event.stopPropagation(); openImporterArticleEditor(article); };
      articleContext.append(button);
    });
    const action = (label, run) => {
      const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=label;
      button.onclick=event=>{event.stopPropagation();hideArticleContext();run();};articleContext.append(button);return button;
    };
    action('Cargar web', () => openWebEditor(row,tr.querySelector('[data-field="descripcion"]')).catch(error=>{backdrop.inert=false;setStatus(error.message,true);}));
    if(row.loadWeb) action('Quitar carga web',()=>{row.loadWeb=false;row.webDraft=null;changed();flushDraft();render();});
    const marginInput=tr.querySelector('[data-field="margen"]');
    if(event.target.closest('[data-field="margen"]')&&marginInput&&!row.sqlSaved){
      const margin=parseMargin(marginInput.value);
      if(Number.isFinite(margin)&&margin>=0)action('Aplicar '+displayMargin(margin)+' a los demás',()=>{
        let count=0;rows.forEach((item,index)=>{if(item.sqlSaved)return;const input=backdrop.querySelector('tr[data-row="'+index+'"] [data-field="margen"]');if(!input)return;beginFieldEdit(input);item.margen=margin;input.value=displayMargin(margin);finishFieldEdit(input);count++;});
        changed();flushDraft();marginInput.focus({preventScroll:true});setStatus('Margen aplicado a '+count+' artículos del lote.');
      });
    }
    const bulto=action('Definir cant. x bulto',()=>{
      const value=window.prompt('Cantidad por bulto (se guarda al aplicar el lote):',String(row.unidadesBulto ?? row.divisorBultoAplicado ?? row.original?.unidadesBulto ?? 1));
      if(value==null)return;
      try {
        const amount=window.CorralonFunciones.evaluateBasicArithmetic(value);
        if(!Number.isFinite(amount)||amount<=0)throw new Error('La cantidad por bulto debe ser mayor que cero.');
        const previous=Number(row.divisorBultoAplicado)||1;
        row.costo=Number(row.costo)*previous/amount;
        row.costoExpression=null;
        row.unidadesBulto=amount;row.divisorBultoAplicado=amount;
        changed();flushDraft();render();
      } catch(error){setStatus(error.message,true);}
    });
    bulto.disabled=Boolean(row.sqlSaved);
    backdrop.append(articleContext);
  });
  const fieldSnapshots = new Map(), undoStack = [];
  let movementId = 0, restoring = false, selectedRowUid = '', selectionAnchor = '';
  const setStatus = (text, error = false, recoverable = false) => {
    statusText.textContent = text;
    status.classList.toggle('error', error);
    reconnect.hidden = !recoverable;
  };
  function saveDraft(strict = false) {
    if (!catalogReady) return;
    if (!rows.length&&!retainedRows.length) return clearDraft();
    const snapshot=structuredClone({operation,rows,retainedRows});
    draftWrite=draftWrite.catch(()=>{}).then(async()=>{
      if (draftCache) {
        await draftCache.write(draftKey,snapshot);
        // Only a small marker remains in localStorage; images stay in IndexedDB.
        try { window.localStorage.setItem(draftKey,JSON.stringify({indexedDb:true})); }
        catch(error) { window.sessionStorage.setItem(draftKey,JSON.stringify({indexedDb:true})); }
      } else window.localStorage.setItem(draftKey,JSON.stringify(snapshot));
    });
    if (strict) return draftWrite.catch(()=>{throw new Error('No se pudo guardar el borrador local. Verificá el espacio disponible en el equipo y volvé a Guardar.');});
    return draftWrite.catch(error=>console.warn('No se pudo guardar el borrador del importador.',error));
  }
  function clearDraft() {
    clearTimeout(draftSaveTimer); draftSaveTimer = 0;
    if(retainedRows.length){rows=[];return saveDraft();}
    try { window.localStorage.removeItem(draftKey); window.sessionStorage.removeItem(draftKey); } catch (error) { console.warn('No se pudo borrar el borrador del importador.', error); }
    draftWrite=draftWrite.catch(()=>{}).then(async()=>{
      if (draftCache) await draftCache.remove(draftKey);
      window.localStorage.removeItem(draftKey);
      window.sessionStorage.removeItem(draftKey);
    });
    return draftWrite.catch(error=>console.warn('No se pudo borrar el borrador del importador.',error));
  }
  function flushDraft(strict = false) { clearTimeout(draftSaveTimer); draftSaveTimer = 0; return saveDraft(strict); }
  async function loadDraft() {
    try {
      const draft = await recoverDraft(providerId,draftScope) || JSON.parse(window.localStorage.getItem(draftKey) || 'null');
      return draft && Array.isArray(draft.rows) && draft.rows.every(row => row && typeof row.codigo === 'string' && typeof row.descripcion === 'string') ? draft : null;
    } catch(error) { throw new Error(`No se pudo recuperar el borrador del importador. No se reemplazó la carga pendiente: ${error.message}`); }
  }
  function hideMenu() { menu?.remove(); menu = null; menuInput = null; menuIndex = -1; menuKind = ''; }
  function close(discard = false) {
    if (busy || articleEditor) return;
    hideArticleContext();
    clearTimeout(draftSaveTimer); draftSaveTimer = 0;
    if (discard) clearDraft(); else saveDraft();
    window.removeEventListener('pagehide', flushOnPageHide);
    hideMenu(); window.removeEventListener('keydown', handleDialogKeydown, true);
    window.removeEventListener('focusin', guardFocus, true);
    window.removeEventListener('keyup', guardKeyup, true);
    backgroundInert.forEach(([element, inert]) => { element.inert = inert; });
    backdrop.remove(); active = false; returnFocus?.focus?.({ preventScroll:true });
    options.onClose?.({discard});
  }
  function changed() {
    operation = (window.CorralonFunciones?.createUuid?.() || crypto.randomUUID());
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => { draftSaveTimer = 0; saveDraft(); }, 500);
  }
  function flushOnPageHide() { flushDraft(); }
  window.addEventListener('pagehide', flushOnPageHide);
  const rowCopy = row => ({ ...row, ...(row.original ? { original:{ ...row.original } } : {}) });
  const rowAt = element => rows[Number(element?.closest('[data-row]')?.dataset.row)];
  function beginFieldEdit(input) {
    const row = rowAt(input);
    if (!row || fieldSnapshots.has(input)) return;
    fieldSnapshots.set(input, { uid:row.uid, field:input.dataset.field, before:rowCopy(row) });
  }
  function finishFieldEdit(input) {
    const snapshot = fieldSnapshots.get(input);
    if (!snapshot) return;
    fieldSnapshots.delete(input);
    const current = rows.find(row => row.uid === snapshot.uid);
    if (!restoring && current && JSON.stringify(current) !== JSON.stringify(snapshot.before)) {
      undoStack.push({ idMov:++movementId, ...snapshot });
      if (undoStack.length > 100) undoStack.shift();
    }
  }
  function restoreFieldEdit(movement, focus = true) {
    const index = rows.findIndex(row => row.uid === movement.uid);
    if (index < 0) return false;
    restoring = true;
    fieldSnapshots.clear();
    rows[index] = rowCopy(movement.before);
    changed(); render();
    restoring = false;
    if (focus) {
      const target = backdrop.querySelector(`tr[data-row="${index}"] [data-field="${movement.field}"]`);
      target?.focus({ preventScroll:true });
      if (target?.dataset.field === 'descripcion') hideMenu();
    }
    return true;
  }
  function undoField(input) {
    const activeSnapshot = fieldSnapshots.get(input);
    if (activeSnapshot) {
      const current = rows.find(row => row.uid === activeSnapshot.uid);
      if (current && JSON.stringify(current) !== JSON.stringify(activeSnapshot.before)) {
        restoreFieldEdit(activeSnapshot);
        setStatus('Edición actual deshecha.');
        return true;
      }
      fieldSnapshots.delete(input);
    }
    const movement = undoStack.pop();
    if (!movement) return false;
    restoreFieldEdit(movement);
    setStatus(`Movimiento ${movement.idMov} deshecho.`);
    return true;
  }
  function parseMargin(value) {
    const text = String(value ?? '').replace(/[%\s]/g, '');
    if (/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(text)) return Number(text.replace(/\./g, '').replace(',', '.'));
    if (!text || !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return NaN;
    return Number(text.replace(',', '.'));
  }
  function displayMargin(value) {
    return Number.isFinite(value) ? `${value.toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })} %` : '';
  }
  function costDifference(row) {
    const oldCost = Number(row.original?.costo);
    if (!row.original || !Number.isFinite(oldCost) || oldCost <= 0) return '—';
    const difference = (row.costo - oldCost) / oldCost * 100;
    if (Math.abs(difference) < .005) return '';
    return `${difference > 0 ? '+' : ''}${difference.toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })} %`;
  }
  function isUnchangedPriceRow(row) {
    const original = row?.original;
    return options.applyPrices && original && row.mode === 'update' && row.id && row.version
      && !row.loading && !row.sqlSaved && !row.reactivar && !row.loadWeb && !row.costoExpression && row.unidadesBulto == null
      && row.costo > 0 && money(row.costo) === money(original.costo)
      && row.codigo === String(original.codigo ?? '').trim() && row.descripcion === original.descripcion
      && Number(row.rubro) === Number(original.rubro) && Number(row.iva) === Number(original.iva)
      && Math.abs(row.margen - row.originalMargin) < .000001;
  }
  function summary() {
    const visible=rows.filter(row=>!isUnchangedPriceRow(row));
    const unchanged=rows.length-visible.length;
    const updates=visible.filter(row=>row.mode==='update'&&row.id&&row.version).length;
    const unresolved=visible.filter(row=>row.mode==='update'&&(!row.id||!row.version)).length;
    backdrop.querySelectorAll('tr[data-row]').forEach(tr=>{tr.hidden=Boolean(isUnchangedPriceRow(rows[Number(tr.dataset.row)]));});
    backdrop.querySelector('[data-summary]').textContent=`${visible.length-updates-unresolved} nuevos · ${updates} para actualizar${unresolved?` · ${unresolved} por identificar`:''}${unchanged?` · ${unchanged} sin cambios`:''}`;
    apply.disabled=busy||!visible.length||Boolean(unresolved)||visible.some(row=>row.loading);
  }
  function canEditSupplierCode(row) {
    return options.editableSource || row.codigoManual === true || !row.codigo.trim();
  }
  function render() {
    hideMenu();
    for(const row of rows){
      if(!row.sqlSaved&&Number(row.unidadesBulto)>0&&Number(row.divisorBultoAplicado)!==Number(row.unidadesBulto)){
        row.costo=importUnitCost(row);row.divisorBultoAplicado=Number(row.unidadesBulto);row.costoExpression=null;
      }
    }
    backdrop.querySelector('tbody').innerHTML = rows.map((r, i) => `<tr data-row="${i}" class="local-import-row${selectedRowUid === r.uid ? ' local-selected' : ''}">
      <td><input ${options.editableSource?`data-field="id" maxlength="6" placeholder="${r.mode==='update'?'Elegir IDArt':'Automático'}"`:'readonly'} value="${escape(options.editableSource?r.id||'':r.mode === 'new' ? 'Automático' : r.id || 'Elegir →')}"${r.resolutionMessage?` title="${escape(r.resolutionMessage)}"`:''}></td>
      <td><input ${canEditSupplierCode(r)?'data-field="codigo" maxlength="30" aria-label="Código de proveedor"':'readonly'} value="${escape(r.codigo)}"></td>
      <td><div class="local-articles-combo"><input data-field="descripcion" autocomplete="off" maxlength="100" value="${escape(r.descripcion)}" placeholder="Buscar por código o descripción…"${r.original ? ` title="Costo anterior: ${escape(money(r.original.costo))}"` : ''}><button type="button" data-article-toggle tabindex="-1" title="Buscar artículo">▼</button></div></td>
      <td><div class="local-articles-combo"><input data-field="rubro" autocomplete="off" value="${escape(rubros.find(item => Number(item.id) === Number(r.rubro))?.nombre || '')}" placeholder="Elegir rubro"><button type="button" data-rubro-toggle tabindex="-1" title="Buscar rubro">▼</button></div></td>
      <td><select data-field="iva"><option value="0.21">21 %</option><option value="0.105">10,5 %</option>${![.21,.105].some(v => Math.abs(v-r.iva)<.00001) ? `<option value="${Number(r.iva)}">${Number(r.iva)*100} %</option>` : ''}</select></td>
      <td><input data-field="margen" inputmode="decimal" value="${displayMargin(r.margen)}"></td>
      <td class="num"><input data-field="costo" inputmode="text" value="${escape(r.costoExpression??money(r.costo))}"></td><td class="num">${r.original ? money(r.original.costo) : '—'}</td><td class="num" data-difference>${costDifference(r)}</td>
      <td>${r.loadWeb ? '<span title="Se cargará en la web al aplicar el lote" style="color:#087a43;font-weight:bold">Web ✓</span>' : ''}${r.unidadesBulto != null ? `<span title="Cantidad por bulto"> · Bulto: ${escape(r.unidadesBulto)}</span>` : ''}<button type="button" data-remove title="Quitar">×</button></td>
    </tr>`).join('');
    backdrop.querySelectorAll('tr[data-row]').forEach(tr => {
      const row = rows[Number(tr.dataset.row)];
      if (row.sqlSaved) tr.querySelectorAll('[data-field], [data-article-toggle], [data-rubro-toggle]').forEach(input => input.disabled = true);
      tr.querySelector('[data-field="iva"]').value = String([.21,.105].find(v => Math.abs(v-row.iva)<.00001) ?? row.iva);
    });
    summary();
  }
  function attachExistingArticle(row,article,keepEdits=false){
    const previous=row.original;
    const margin=Number(article.margen)*100;
    if(!keepEdits||row.margen===row.originalMargin)row.margen=margin;
    if(!keepEdits||row.rubro===Number(previous?.rubro))row.rubro=Number(article.rubro);
    if(!keepEdits||row.iva===Number(previous?.iva))row.iva=Number(article.iva);
    if(!keepEdits||row.descripcion===previous?.descripcion)row.descripcion=article.descripcion;
    Object.assign(row,{mode:'update',id:article.id,version:article.version,original:article,originalMargin:margin,
      reactivar:article.suspendido===true||Number(article.suspendido)===1,newConfirmed:true,needsNewConfirmation:false});
    delete row.resolutionMessage;
  }
  async function preparePriceRows(sourceRows,seedRow,draft){
    const legacy=!draft&&draftScope ? await draftCache?.read(importDraftKey(providerId)) : null;
    const currentIds=new Set(sourceRows.map(source=>source.sourceRowId).filter(Boolean));
    const savedRows=[...(draft?.rows||legacy?.rows||[]),...(draft?.retainedRows||[])];
    const bySource=new Map(savedRows.filter(row=>currentIds.has(row.sourceRowId)&&(!legacy||!row.sqlSaved)).map(row=>[row.sourceRowId,row]));
    retainedRows=draft?savedRows.filter(row=>!currentIds.has(row.sourceRowId)):[];
    const codeKey=code=>normalize(code).replace(/\s+/g,'');
    const idKey=id=>String(id||'').trim().replace(/^0+(?=\d)/,'');
    const byId=new Map(catalog.map(article=>[idKey(article.id),article]));
    const byCode=new Map();
    for(const article of catalog){
      if(Number(article.proveedor)!==providerId||!article.codigo)continue;
      const code=codeKey(article.codigo),matches=byCode.get(code)||[];
      matches.push(article);byCode.set(code,matches);
    }
    const details=new Map();
    let next=0;
    const prepared=sourceRows.map(source=>{
      const seed=seedRow(source),saved=bySource.get(source.sourceRowId);
      if(!saved)return seed;
      const row={...seed,...saved,loading:false,lookup:null};
      if(saved.sourceCost===saved.costo&&!saved.costoExpression&&!saved.unidadesBulto)row.costo=seed.costo;
      row.sourceCost=seed.costo;
      return row;
    });
    await Promise.all(Array.from({length:Math.min(4,prepared.length)},async()=>{
      while(next<prepared.length){
        const index=next++,row=prepared[index],source=sourceRows[index];
        if(row.sqlSaved)continue;
        const savedId=row.mode==='update'?row.id:'';
        const requestedId=idKey(savedId||source.idart);
        const matches=byCode.get(codeKey(row.codigo))||[];
        const match=requestedId?byId.get(requestedId):matches.length===1?matches[0]:null;
        if(!requestedId&&!matches.length)continue;
        const unresolved=message=>Object.assign(row,{mode:'update',id:'',version:'',original:null,resolutionMessage:message});
        if(!match||(!savedId&&Number(match.proveedor)!==providerId)){
          unresolved(requestedId?'El IDArt no está activo para este proveedor. Elegí el artículo.':'Hay varios artículos para este código. Elegí el IDArt.');
          continue;
        }
        try{
          if(!details.has(match.id))details.set(match.id,api(`article?id=${encodeURIComponent(match.id)}`));
          const article=await details.get(match.id);
          if(!article.version||(!savedId&&Number(article.proveedor)!==providerId))throw new Error('El artículo cambió de proveedor o no se pudo verificar.');
          attachExistingArticle(row,article,Boolean(savedId&&row.original));
        }catch(error){unresolved(error.message);}
      }
    }));
    return prepared;
  }
  async function pick(row, id) {
    const sourceInput = menuInput;
    let selected=false;
    hideMenu(); row.loading = true; row.mode = 'update'; row.id = ''; row.newConfirmed = true; summary();
    const requestId = row.lookup = (window.CorralonFunciones?.createUuid?.() || crypto.randomUUID());
    setStatus('Leyendo los datos actuales del artículo…');
    try {
      const article = await api(`article?id=${encodeURIComponent(id)}${showSuspended?'&suspendidos=1':''}`);
      if (!backdrop.isConnected || row.lookup !== requestId || row.mode !== 'update') return;
      attachExistingArticle(row,article);
      if (sourceInput) finishFieldEdit(sourceInput);
      selected=true;
      changed(); setStatus('Revisá los datos. El proveedor, código y costo nuevos vienen de la lista seleccionada.');
    } catch (error) { setStatus(error.message, true); }
    finally {
      if(row.lookup===requestId){
        row.loading=false;
        if(backdrop.isConnected){
          render();
          const index=rows.indexOf(row);
          if(index>=0)focusGrid(index,editableFields.indexOf(selected?'rubro':'descripcion'));
        }
      }
    }
  }
  async function openWebEditor(row, input) {
    if (busy || !confirmNew(row,true)) { input.checked=false; return; }
    if (!row.rubro || !row.descripcion.trim() || !(row.costo>0) || !Number.isFinite(row.margen) || row.margen<0) {
      input.checked=false; setStatus('Completá artículo, rubro, costo y margen antes de cargar web.',true); return;
    }
    const previousLoadWeb=Boolean(row.loadWeb);
    row.loadWeb=true; changed(); flushDraft(); hideMenu(); backdrop.inert=true;
    const existingCode=row.sqlSaved?.id || row.id;
    let existing=null;
    try {
      if(existingCode)existing=await window.CorralonSystem.catalog.fetchArticle(existingCode);
    } catch(error) {
      backdrop.inert=false;row.loadWeb=previousLoadWeb;input.checked=previousLoadWeb;changed();flushDraft();
      setStatus(`No se pudo leer la ficha web existente: ${error.message}`,true);return;
    }
    if(!backdrop.isConnected){backdrop.inert=false;return;}
    const seed={...(existing || {}),...(row.webDraft || {}),codigo:existingCode || row.uid,nombre:row.descripcion,codigoProveedor:row.codigo,rubro:rubros.find(r=>Number(r.id)===Number(row.rubro))?.nombre || '',precio:row.sqlSaved?.venta3 ?? row.costo*(1+row.iva)*(1+row.margen/100)};
    window.CorralonSystem.articleEditor.open(seed.codigo,{articles:[seed],displayCode:row.sqlSaved?.id || row.id || 'Automático',returnFocus:input,operation:{
      articles:[seed],deferImages:true,
      async save(list,article) {
        const previous=row.webDraft;
        row.webDraft=article; row.loadWeb=true;
        try { await saveDraft(true); } catch(error) { row.webDraft=previous; throw error; }
        setStatus('Ficha web guardada en el borrador local. Se publicará al aplicar el importador.');
      },
      onClose() {
        backdrop.inert=false;
        row.loadWeb=Boolean(row.webDraft); changed(); flushDraft(); render();
      }
    }});
  }
  function descriptionMatchesOnly(){
    try{return localStorage.getItem('corralon_stock_description_matches_only_v1')==='1';}catch{return false;}
  }
  function search(input, row) {
    hideMenu(); menuInput = input; menuKind = 'article';
    const queryText = input.value;
    const query = normalize(queryText);
    const normalizedQuery = normalizeIndexFilter(queryText);
    const queryFilter = { query:normalizedQuery, compactQuery:compactIndexFilter(normalizedQuery), terms:normalizedQuery.split(' ').filter(Boolean) };
    const rowCode = normalize(row?.codigo);
    const hasSameProviderCode = Boolean(rowCode) && catalogSorted.some(article => article.searchCode === rowCode);
    const ranks = new Map();
    const filterRank = article => {
      if (ranks.has(article)) return ranks.get(article);
      const base = rowCode && article.searchCode === rowCode ? -2 : article.searchCode === query ? -1 :
        indexDescriptionFilterRank(article.descripcion, queryText, { ...queryFilter, text:article.searchDescription, compactText:article.searchCompact, words:article.searchWords });
      const firstWord = (article.searchWords || normalizeIndexFilter(article.descripcion).split(' '))[0] || '';
      const firstTerm = queryFilter.terms[0] || '';
      const value = Number.isFinite(base) && firstTerm ? (firstWord === firstTerm ? 0 : firstWord.startsWith(firstTerm) ? 1 : 2) * 20 + base : base;
      ranks.set(article,value);
      return value;
    };
    const isMatch = article => Number.isFinite(filterRank(article));
    articlePage = window.CorralonSystem.articleOptionPager.create(descriptionMatchesOnly() && query ? catalogSorted.filter(isMatch) : catalogSorted, {
      key: article => String(article.id),
      description: article => article.descripcion,
      isMatch,
      rank: filterRank,
      hasSearch: Boolean(query) || hasSameProviderCode, beforeCount:hasSameProviderCode ? 0 : 20, afterCount:40, matchLimit:100, preordered:true
    });
    articleHasMatch = articlePage.options.some(isMatch);
    menu = document.createElement('div'); menu.className = 'local-articles-search article'; menu.setAttribute('role','listbox');
    const rect = input.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width * 2, 1000), innerWidth - 16);
    menu.style.left = `${Math.max(8,Math.min(rect.left,innerWidth-width-8))}px`;
    menu.style.width = `${width}px`;
    const below = innerHeight-rect.bottom-8, above = rect.top-8;
    const openUp = below < 240 && above > below;
    menu.style.maxHeight = `${Math.max(120,Math.min(340,openUp ? above : below))}px`;
    if (openUp) menu.style.bottom = `${innerHeight-rect.top+3}px`; else menu.style.top = `${rect.bottom+3}px`;
    renderArticleMenu(query);
    menu.addEventListener('mousedown', e => e.preventDefault());
    menu.addEventListener('click', e => {
      if(e.target.closest('[data-show-suspended]')){
        if(busy)return;
        const previous=showSuspended;showSuspended=!showSuspended;
        refreshConnection().then(ok=>{
          if(!ok){showSuspended=previous;return;}
          const refreshedInput=backdrop.querySelector(`tr[data-row="${rows.indexOf(row)}"] [data-field="descripcion"]`);
          if(refreshedInput){refreshedInput.focus({preventScroll:true});search(refreshedInput,row);}
        });return;
      }
      if(e.target.closest('[data-description-filter]')){
        if(!normalize(input.value))return;
        try{localStorage.setItem('corralon_stock_description_matches_only_v1',descriptionMatchesOnly()?'0':'1');}catch{}
        search(input,row);return;
      }
      const button=e.target.closest('[data-match]');if(button)pick(row,matches[Number(button.dataset.match)].id);
    });
    menu.addEventListener('scroll', () => {
      if (menuKind !== 'article' || !articlePage) return;
      if (menu.scrollTop < 16 && articlePage.beforeCursor >= 0) {
        const oldHeight = menu.scrollHeight, oldTop = menu.scrollTop;
        const added = window.CorralonSystem.articleOptionPager.extend(articlePage,'up');
        if (!added.length) return;
        const selectedId = matches[menuIndex]?.id;
        renderArticleMenu(query,selectedId);
        menu.scrollTop = oldTop + menu.scrollHeight - oldHeight;
      } else if (menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 16 && articlePage.afterCursor < articlePage.source.length) {
        const oldTop = menu.scrollTop;
        const added = window.CorralonSystem.articleOptionPager.extend(articlePage,'down');
        if (!added.length) return;
        const selectedId = matches[menuIndex]?.id;
        renderArticleMenu(query,selectedId);
        menu.scrollTop = oldTop;
      }
    });
    document.body.append(menu);
    if (query && menuIndex >= 0) {
      const currentMenu = menu;
      requestAnimationFrame(() => { if (currentMenu.isConnected && menu === currentMenu) showActiveArticle(true); });
    }
  }
  function renderArticleMenu(query, selectedId = articlePage?.options[articlePage.focusIndex]?.id) {
    if (!menu) return;
    matches = articlePage?.options || [];
    menuIndex = query && articleHasMatch ? matches.findIndex(article => article.id === selectedId) : -1;
    menu.innerHTML = '<div class="local-articles-search-head" aria-hidden="true"><span>IDArt</span><span>Cód. proveedor</span><span>Descripción</span><span>Proveedor</span><span>Suspendido SQL</span></div>' + (matches.length ? matches.map((article,index) => `<button type="button" data-match="${index}" role="option"${index === menuIndex ? ' class="active"' : ''}><span>${escape(article.id)}</span><span title="${escape(article.codigo)}">${escape(article.codigo)}</span><span title="${escape(article.descripcion)}">${escape(article.descripcion)}</span><span title="${escape(article.proveedorNombre || 'Sin nombre')}">${escape(article.proveedorNombre || 'Sin nombre')}</span><span>${article.suspendido===true||Number(article.suspendido)===1?'Sí':'No'}</span></button>`).join('') : '<p>Sin coincidencias en la base local.</p>') + `<div class="stock-description-footer"><button type="button" class="stock-description-filter" data-description-filter aria-pressed="${descriptionMatchesOnly()}" ${query?'':'disabled'}>${descriptionMatchesOnly()?'▾ Mostrar lista':'▴ Filtrar'}</button><button type="button" class="stock-description-filter" data-show-suspended aria-pressed="${showSuspended}">Mostrar suspendidos</button></div>`;
  }
  function showActiveArticle(alignTop = false) {
    if (!menu || menuKind !== 'article') return;
    const active = menu.querySelector('[data-match].active');
    if (!active) return;
    const headerBottom = (menu.querySelector('.local-articles-search-head')?.getBoundingClientRect().bottom || menu.getBoundingClientRect().top) + 4;
    const rowRect = active.getBoundingClientRect();
    const bottom = menu.getBoundingClientRect().bottom - 4;
    if (alignTop || rowRect.top < headerBottom) menu.scrollTop = Math.max(0, menu.scrollTop + rowRect.top - headerBottom);
    else if (rowRect.bottom > bottom) menu.scrollTop += rowRect.bottom - bottom;
  }
  function pickRubro(row, id) {
    const sourceInput = menuInput;
    const selected = rubros.find(item => Number(item.id) === Number(id));
    if (!row || !selected) return;
    row.rubro = Number(selected.id);
    if (sourceInput) { sourceInput.value = selected.nombre; finishFieldEdit(sourceInput); }
    changed(); render();
    const index = rows.findIndex(item => item.uid === row.uid);
    focusGrid(index,editableFields.indexOf('iva'));
  }
  function rubroMatchesForText(value) {
    const query = normalize(value);
    const firstWord = query.split(/\s+/)[0];
    return rubros.filter(item => normalize(item.nombre).includes(query))
      .map((item,index) => ({item,index,priority: normalize(item.nombre).split(/\s+/)[0].startsWith(firstWord) ? 0 : 1}))
      .sort((a,b) => a.priority - b.priority || a.index - b.index)
      .slice(0,80).map(({item}) => item);
  }
  function searchRubro(input,row) {
    hideMenu(); menuInput = input; menuKind = 'rubro';
    matches = rubroMatchesForText(input.value);
    menu = document.createElement('div'); menu.className = 'local-articles-search'; menu.setAttribute('role','listbox');
    const rect = input.getBoundingClientRect();
    menu.style.left = `${Math.max(8,Math.min(rect.left,innerWidth-320))}px`;
    menu.style.width = `${Math.min(Math.max(rect.width,320),innerWidth-16)}px`;
    if (innerHeight-rect.bottom < 180) menu.style.bottom = `${innerHeight-rect.top+3}px`;
    else menu.style.top = `${rect.bottom+3}px`;
    menuIndex = matches.length ? 0 : -1;
    menu.innerHTML = matches.length ? matches.map((item,index) => `<button type="button" data-rubro-match="${index}" role="option"${index === menuIndex ? ' class="active"' : ''}>${escape(item.nombre)}</button>`).join('') : '<p>Sin rubros coincidentes.</p>';
    menu.addEventListener('mousedown', e => e.preventDefault());
    menu.addEventListener('click', e => { const button=e.target.closest('[data-rubro-match]'); if(button) pickRubro(row,matches[Number(button.dataset.rubroMatch)].id); });
    document.body.append(menu);
  }
  backdrop.addEventListener('click', e => {
    hideArticleContext();
    if (e.target.closest('[data-cancel]')) { close(true); return; }
    if (e.target.closest('[data-close]')) { close(); return; }
    const articleToggle=e.target.closest('[data-article-toggle]');
    const rubroToggle=e.target.closest('[data-rubro-toggle]');
    if (articleToggle || rubroToggle) {
      const input=(articleToggle || rubroToggle).parentElement.querySelector('input');
      input.focus({ preventScroll:true });
      if (menu && menuInput === input) hideMenu();
      else if (articleToggle) search(input,rowAt(input));
      else searchRubro(input,rowAt(input));
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove && !busy) { rows.splice(Number(remove.closest('[data-row]').dataset.row),1); changed(); render(); }
    if (!e.target.matches('[data-field="descripcion"]')) hideMenu();
    const tr = e.target.closest('tr[data-row]');
    if (tr && !remove) {
      const current = rows[Number(tr.dataset.row)];
      if (e.shiftKey && selectionAnchor) {
        const start = rows.findIndex(row => row.uid === selectionAnchor);
        const end = Number(tr.dataset.row);
        if (start >= 0) backdrop.querySelectorAll('tr[data-row]').forEach((element, index) => element.classList.toggle('local-selected', !element.hidden && index >= Math.min(start,end) && index <= Math.max(start,end)));
      } else {
        selectedRowUid = current?.uid || '';
        selectionAnchor = selectedRowUid;
        backdrop.querySelectorAll('tr[data-row]').forEach(element => element.classList.toggle('local-selected', element === tr));
      }
    }
  });
  backdrop.addEventListener('focusin', e => {
    if (e.target.matches('[data-field]')) beginFieldEdit(e.target);
    if (e.target.matches('[data-field="rubro"], [data-field="margen"]')) e.target.select();
    if (e.target.matches('[data-field="descripcion"]')) {
      const snapshot = fieldSnapshots.get(e.target);
      const row = rowAt(e.target);
      originalDescription.textContent = `Descripción original: ${row?.importedDescription || row?.descripcion || ''}`;
      originalDescription.hidden = false;
    }
  });
  function confirmNew(row, force = false) {
    if (row.mode !== 'new' || row.newConfirmed || !row.needsNewConfirmation) return true;
    const description = row.descripcion.trim();
    if (!description) return false;
    if (catalog.some(article => normalize(article.descripcion) === normalize(description))) {
      setStatus('Ese artículo ya existe. Elegilo del desplegable para actualizarlo.', true);
      return false;
    }
    if (!force && row.declinedDescription === description) return false;
    hideMenu();
    if (window.confirm(`"${description}" no existe en la base. ¿Querés cargarlo como artículo nuevo?`)) {
      row.descripcion = description.toLocaleUpperCase('es-AR');
      const input = [...backdrop.querySelectorAll('[data-field="descripcion"]')].find(element => rowAt(element)?.uid === row.uid);
      if (input) input.value = row.descripcion;
      row.newConfirmed = true;
      row.declinedDescription = '';
      changed();
      setStatus('El artículo se cargará como nuevo. Podés seguir revisando las demás filas.');
      return true;
    }
    row.declinedDescription = description;
    setStatus('Elegí un artículo del desplegable o confirmá que querés cargar uno nuevo.', true);
    return false;
  }
  backdrop.addEventListener('focusout', e => {
    if (!e.target.matches('[data-field]') || busy || restoring) return;
    const row = rows[Number(e.target.closest('[data-row]').dataset.row)];
    if (row && e.target.dataset.field === 'rubro') {
      const selected = rubroMatchesForText(e.target.value)[0];
      if(selected) {
        row.rubro = Number(selected.id);
        e.target.value = selected.nombre;
        changed();
      }
      if(menuInput === e.target) hideMenu();
    }
    if (row && e.target.dataset.field === 'descripcion') confirmNew(row);
    if (row && e.target.dataset.field === 'margen') {
      row.margen = parseMargin(e.target.value);
      if (Number.isFinite(row.margen)) e.target.value = displayMargin(row.margen);
    }
    if(row && e.target.dataset.field==='costo')finishCost(e.target,row);
    finishFieldEdit(e.target);
    if(options.applyPrices)summary();
  });
  backdrop.addEventListener('input', e => {
    const input = e.target.closest('[data-field]'); if (!input || busy) return;
    const tr = input.closest('[data-row]'), row = rows[Number(tr.dataset.row)], field = input.dataset.field;
    if (field === 'descripcion') {
      row.descripcion = input.value;
      row.mode = 'new'; row.id = ''; row.original = null; row.version = ''; row.lookup = null;
      row.needsNewConfirmation = true; row.newConfirmed = false; row.declinedDescription = '';
      delete row.resolutionMessage;
      search(input,row); summary();
      tr.querySelector('td:first-child input').value = options.editableSource?'':'Automático';
    }
    if (field === 'rubro') {
      const selected = rubros.find(item => normalize(item.nombre) === normalize(input.value));
      row.rubro = selected ? Number(selected.id) : 0;
      searchRubro(input,row);
    }
    if (field === 'margen') row.margen = parseMargin(input.value);
    if (field === 'codigo') {
      if (row.sqlSaved || !canEditSupplierCode(row)) return;
      if (!row.codigo.trim()) row.codigoManual = true;
      row.codigo = input.value.trim();
    }
    if(field==='id'){
      row.id=input.value.trim();row.mode='new';row.original=null;row.version='';row.lookup=null;
      if(options.applyPrices&&row.id){row.mode='update';row.resolutionMessage='Elegí un IDArt existente.';}
      else delete row.resolutionMessage;
      summary();
    }
    if(field==='costo'){
      row.costoExpression=input.value;
      try{row.costo=window.CorralonFunciones.evaluateBasicArithmetic(input.value);input.setCustomValidity('');}catch{}
      tr.querySelector('[data-difference]').textContent=costDifference(row);
    }
    changed();
  });
  backdrop.addEventListener('change', e => {
    const input = e.target.closest('[data-field]'); if (!input || busy) return;
    const row = rows[Number(input.closest('[data-row]').dataset.row)], field = input.dataset.field;
    if (field === 'iva') {
      row[field]=Number(input.value); changed();
    }
    if(field==='id'&&row.id){
      const id=options.applyPrices&&/^\d{1,6}$/.test(row.id)?row.id.padStart(6,'0'):row.id;
      if(catalog.some(article=>String(article.id)===id))pick(row,id);
    }
  });
  function finishCost(input,row){
    try{
      const keepUnitCost=Number(row.divisorBultoAplicado)>0&&!row.costoExpression&&input.value===money(row.costo);
      const cost=keepUnitCost?row.costo:window.CorralonFunciones.evaluateBasicArithmetic(input.value);
      if(cost<=0)throw new Error('El costo debe ser mayor que cero.');
      row.costo=cost;delete row.costoExpression;input.value=money(cost);input.setCustomValidity('');changed();return true;
    }
    catch(error){input.setCustomValidity(error.message);setStatus(error.message,true);return false;}
  }
  const editableFields = [...(options.editableSource ? ['id'] : []), 'codigo', 'descripcion', 'rubro', 'iva', 'margen', 'costo'];
  function focusGrid(rowIndex, fieldIndex, direction = 1) {
    while (rowIndex >= 0 && rowIndex < rows.length && isUnchangedPriceRow(rows[rowIndex])) rowIndex += direction;
    if (rowIndex >= rows.length) { (apply.disabled ? backdrop.querySelector('[data-close]') : apply).focus(); return; }
    if (rowIndex < 0) rowIndex = rows.findIndex(row=>!isUnchangedPriceRow(row));
    if (rowIndex < 0) return;
    const field = editableFields[Math.max(0, Math.min(editableFields.length-1, fieldIndex))];
    const target = field === 'codigo' && !canEditSupplierCode(rows[rowIndex]) ? 'descripcion' : field;
    backdrop.querySelector(`tr[data-row="${rowIndex}"] [data-field="${target}"]`)?.focus({ preventScroll:true });
  }
  function moveGrid(input, direction, edge = false) {
    const rowIndex = Number(input.closest('[data-row]').dataset.row);
    const field = input.dataset.field;
    hideMenu();
    if (direction === 'up' || direction === 'down') {
      const nextRow = direction === 'up' ? (edge ? 0 : rowIndex - 1) : (edge ? rows.length - 1 : rowIndex + 1);
      focusGrid(nextRow, editableFields.indexOf(field),edge?(direction==='up'?1:-1):(direction==='up'?-1:1));
      return;
    }
    const fields = canEditSupplierCode(rows[rowIndex]) ? editableFields : editableFields.filter(name => name !== 'codigo');
    const forward = direction === 'right';
    const nextField = edge ? (forward ? fields.length - 1 : 0) : fields.indexOf(field) + (forward ? 1 : -1);
    if (nextField >= fields.length) focusGrid(rowIndex + 1, 0);
    else if (nextField < 0) focusGrid(rowIndex - 1, editableFields.length - 1,-1);
    else focusGrid(rowIndex, editableFields.indexOf(fields[nextField]));
  }
  function atTextEdge(input, direction) {
    if (typeof input.selectionStart !== 'number') return true;
    const all = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    return all || (direction === 'left' ? input.selectionStart === 0 : input.selectionEnd === input.value.length);
  }
  function handleDialogKeydown(e) {
    if (backdrop.inert) return;
    if (!backdrop.isConnected) return;
    if (articleEditor) return;
    if (e.key === 'Escape' && articleContext) { e.preventDefault(); e.stopImmediatePropagation(); hideArticleContext(); return; }
    const inDialog = backdrop.contains(e.target) || menu?.contains(e.target);
    const undo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
    e.stopImmediatePropagation();
    if (!inDialog) { e.preventDefault(); if (!undo) { focusInside(); return; } }
    if (undo) e.preventDefault();
    const input = e.target.closest?.('[data-field]');
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!busy && input && fieldSnapshots.has(input)) {
        const snapshot = fieldSnapshots.get(input);
        const current = rows.find(row => row.uid === snapshot.uid);
        if (current && JSON.stringify(current) !== JSON.stringify(snapshot.before)) {
          restoreFieldEdit(snapshot); setStatus('Edición actual cancelada.'); return;
        }
      }
      hideMenu(); return;
    }
    if (busy || (!inDialog && !undo)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); if (!undoField(input)) setStatus('No hay movimientos para deshacer.'); return;
    }
    if (e.key === 'Tab' && !input) {
      e.preventDefault();
      const fields = [...backdrop.querySelectorAll('input:not([disabled]),select:not([disabled]),button:not([disabled])')].filter(element => !element.hidden && !element.closest('[hidden]'));
      const index = fields.indexOf(document.activeElement);
      fields[(index + (e.shiftKey ? -1 : 1) + fields.length) % fields.length]?.focus({preventScroll:true});
      return;
    }
    if (!input) return;
    if (e.key === 'F2' && input.tagName === 'INPUT') {
      e.preventDefault();
      if (input.selectionStart === 0 && input.selectionEnd === input.value.length) input.setSelectionRange(input.value.length,input.value.length);
      else input.select();
      return;
    }
    if (e.key === 'F4' && ['descripcion','rubro'].includes(input.dataset.field)) {
      e.preventDefault();
      if (menu && menuInput === input) hideMenu();
      else if (input.dataset.field === 'descripcion') search(input,rowAt(input));
      else searchRubro(input,rowAt(input));
      return;
    }
    if (menu && input === menuInput && ['ArrowDown','ArrowUp','Enter'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'Enter') {
        if (menuIndex >= 0 && matches[menuIndex]) {
          if (menuKind === 'article') pick(rowAt(input),matches[menuIndex].id);
          else pickRubro(rowAt(input),matches[menuIndex].id);
        }
        else if (menuKind === 'article') {
          if (confirmNew(rowAt(input), true)) moveGrid(input,'right');
        } else { hideMenu(); moveGrid(input,'right'); }
        return;
      }
      if (matches.length) {
        menuIndex = Math.max(0,Math.min(matches.length-1,menuIndex+(e.key==='ArrowDown'?1:-1)));
        menu.querySelectorAll('[data-match],[data-rubro-match]').forEach((button,index)=>button.classList.toggle('active',index===menuIndex));
        if (menuKind === 'article') showActiveArticle();
        else menu.querySelector('.active')?.scrollIntoView({block:'nearest'});
      }
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if(input.dataset.field==='costo' && !finishCost(input,rowAt(input)))return;
      if (input.dataset.field === 'descripcion' && !confirmNew(rowAt(input), true)) return;
      moveGrid(input,e.shiftKey ? 'left' : 'right'); return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); moveGrid(input,e.key === 'ArrowUp' ? 'up' : 'down',e.ctrlKey); return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && atTextEdge(input,e.key === 'ArrowLeft' ? 'left' : 'right')) {
      e.preventDefault(); moveGrid(input,e.key === 'ArrowLeft' ? 'left' : 'right',e.ctrlKey);
    }
  }
  window.addEventListener('keydown', handleDialogKeydown, true);
  apply.addEventListener('click', async () => {
    if (busy) return;
    for(const input of backdrop.querySelectorAll('tr:not([hidden]) [data-field="costo"]')){
      const row=rowAt(input);if(!row.sqlSaved && !finishCost(input,row)){input.focus();return;}
    }
    const batch=rows.filter(row=>!isUnchangedPriceRow(row));
    if(!batch.length){summary();return;}
    const sqlRows=batch.filter(r=>!r.sqlSaved);
    for (const row of sqlRows) if (!confirmNew(row, true)) return;
    const invalid = batch.find(r => (r.mode==='update'&&(!r.id||!r.version)) || !r.rubro || !r.descripcion.trim() || !Number.isFinite(r.margen) || r.margen<0 || !(r.costo>0));
    if(invalid) { setStatus('Completá artículo, rubro, costo y margen en todas las filas.',true); return; }
    const descriptions = new Set();
    for (const row of sqlRows.filter(row => row.mode !== 'update')) {
      const description = normalize(row.descripcion);
      const reason = !description ? 'La descripción está vacía' : description.length > 100 ? 'La descripción supera los 100 caracteres' : descriptions.has(description) ? 'La descripción está repetida en el lote' : '';
      if (reason) {
        setStatus(`${reason}: fila ${rows.indexOf(row)+1}, código ${row.codigo || 'sin código'}. Corregila antes de aplicar.`,true);
        backdrop.querySelector(`tr[data-row="${rows.indexOf(row)}"] [data-field="descripcion"]`)?.focus();
        await flushDraft(); return;
      }
      descriptions.add(description);
    }
    try { await flushDraft(true); } catch(error) { setStatus(error.message,true); return; }
    busy=true; apply.disabled=true;
    try {
      await enqueue({operation,provider:providerId,providerName:options.provider.proveedor||options.provider.nombre||'',draftScope,rows:batch},options.onImported,token,()=>open(options,window,document));
      busy=false; close(true);
      try { options.showMessage?.('Carga en cola. Continúa en segundo plano.'); } catch(error) { console.warn(error); }
    } catch(error) {
      busy=false;setStatus(`No se pudo poner la carga en cola: ${error.message}`,true);summary();
    }
  });
  async function refreshConnection() {
    if (busy) return;
    busy=true; reconnect.disabled=true; setStatus('Restableciendo la conexión con SQL Server…');
    try {
      const data=await api(`catalog${showSuspended?'?suspendidos=1':''}`);
      if (!backdrop.isConnected) return;
      token=data.token; catalog=data.articles.map(a=>{
        const searchDescription=normalizeIndexFilter(a.descripcion);
        return {...a, searchCode:normalize(a.codigo), searchDescription,
          searchCompact:searchDescription.replace(/\s+/g,''), searchWords:searchDescription.split(' ').filter(Boolean)};
      }); rubros=data.rubros;
      catalogSorted=catalog.slice().sort((a,b)=>String(a.descripcion || '').localeCompare(String(b.descripcion || ''),'es',{sensitivity:'base'}) || String(a.id).localeCompare(String(b.id)));
      backdrop.querySelector('[data-provider]').textContent=`${options.provider.proveedor || options.provider.nombre || ''} · ${catalog.length.toLocaleString('es-AR')} artículos leídos desde SQL Server`;
      if (!catalogReady) {
        const draft = await loadDraft();
        const counts=new Map(); catalog.filter(a=>Number(a.proveedor)===providerId).forEach(a=>counts.set(Number(a.rubro),(counts.get(Number(a.rubro))||0)+1));
        const defaultRubro=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
        const importedRows = Array.isArray(options.rows) ? options.rows : [];
        const importedText = source => String(source?.descripcion || source?.articulo || '').trim().toLocaleUpperCase('es-AR');
        const importedCode = source => String(source?.codigo || source?.cod_proveedor || source?.codProveedor || '').trim();
        const seedRow=source=>{
          const costo=Number(source.costo ?? source.precio_costo ?? source.precioFinal ?? 0);
          return {uid:(window.CorralonFunciones?.createUuid?.() || crypto.randomUUID()),sourceRowId:source.sourceRowId||'',mode:'new',id:'',codigo:importedCode(source),descripcion:importedText(source),importedDescription:importedText(source),costo,sourceCost:costo,divisorBultoAplicado:Number(source.divisorBultoAplicado)||undefined,rubro:Number(source.idRubro || source.id_rubro || defaultRubro),iva:.21,margen:60,newConfirmed:true,needsNewConfirmation:false};
        };
        if(options.applyPrices&&importedRows.length){
          setStatus('Identificando artículos existentes y leyendo sus costos en SQL…');
          rows=await preparePriceRows(importedRows,seedRow,draft);
        }else if(draft){
          retainedRows=draft.retainedRows||[];
          rows=draft.rows.map(row=>({ ...row,
            importedDescription:row.importedDescription || importedText(row.codigo && importedRows.find(source=>importedCode(source)===row.codigo)) || row.descripcion,
            uid:row.uid || (window.CorralonFunciones?.createUuid?.() || crypto.randomUUID()), loading:false, lookup:null }));
          if(draft.operation)operation=draft.operation;
        }else rows=importedRows.map(seedRow);
        catalogReady=true;
        render();
        await saveDraft();
        const unresolved=rows.some(row=>row.resolutionMessage);
        if(unresolved)setStatus('Elegí el IDArt de las filas por identificar antes de aplicar.',true);
        else setStatus(draft ? 'Borrador recuperado. Podés seguir donde lo dejaste.' : 'Conexión restablecida. Podés continuar y aplicar el lote.');
      } else {
        render(); setStatus('Conexión restablecida. Podés continuar y aplicar el lote.');
      }
      return true;
    } catch(error) {
      setStatus(`${error.message} Cerrá y abrí Corralón Local si tampoco responde al reintentar.`,true,true);
      return false;
    } finally {
      busy=false; reconnect.disabled=false; summary();
    }
  }
  reconnect.addEventListener('click', refreshConnection);
  await refreshConnection();
}

