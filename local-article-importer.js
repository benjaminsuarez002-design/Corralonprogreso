// Loaded only by the importer on localhost. No database credentials reach the browser.
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
function indexDescriptionFilterRank(description, queryText) {
  const query = normalizeIndexFilter(queryText);
  if (!query) return 0;
  const text = normalizeIndexFilter(description);
  if (!text) return Number.POSITIVE_INFINITY;
  const compactQuery = compactIndexFilter(query);
  const compactText = compactIndexFilter(text);
  const terms = query.split(' ').filter(Boolean);
  const words = text.split(' ').filter(Boolean);
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
const draftKey = providerId => `corralon_local_article_import_draft_v1_${providerId}`;
export function hasDraft(providerId) {
  try { return Boolean(localStorage.getItem(draftKey(providerId))); } catch { return false; }
}

async function api(path, options = {}) {
  const response = await fetch(`/api/local-articles/${path}`, { cache:'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No respondió el importador local. Verificá que el servidor esté actualizado.');
  return data;
}

export async function open(options) {
  if (active && document.querySelector('.local-articles-backdrop')) return;
  // Si otra actualización quitó el popup del DOM, no conservar un bloqueo fantasma.
  active = false;
  active = true;
  const returnFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'local-articles-backdrop';
  backdrop.innerHTML = `<section class="local-articles-dialog" role="dialog" aria-modal="true" aria-labelledby="localArticlesTitle">
    <header><div><h2 id="localArticlesTitle">Importar o actualizar artículos</h2><p data-provider></p><p data-original-description hidden></p></div><button type="button" data-close>Cerrar</button></header>
    <div class="local-articles-scroll"><table class="new-articles-table"><colgroup><col style="width:105px"><col style="width:115px"><col><col style="width:155px"><col style="width:75px"><col style="width:92px"><col style="width:112px"><col style="width:112px"><col style="width:85px"><col style="width:34px"></colgroup><thead><tr><th>IDArt</th><th>Cód. proveedor</th><th>Artículo</th><th>Rubro</th><th>IVA</th><th>Margen %</th><th>Costo nuevo</th><th>Precio viejo</th><th title="Diferencia entre el costo nuevo y el precio viejo">Dif. %</th><th></th></tr></thead><tbody></tbody></table></div>
    <div data-status role="status"><span data-status-text>Leyendo artículos de la base local…</span><button type="button" data-reconnect hidden>Restablecer conexión</button></div><footer><span data-summary></span><button type="button" data-cancel>Cancelar</button><button type="button" class="primary" data-apply disabled>Aplicar todos</button></footer>
  </section>`;
  document.body.append(backdrop);
  const status = backdrop.querySelector('[data-status]'), statusText = backdrop.querySelector('[data-status-text]');
  const originalDescription = backdrop.querySelector('[data-original-description]');
  const reconnect = backdrop.querySelector('[data-reconnect]'), apply = backdrop.querySelector('[data-apply]');
  const providerId = Number(options.provider.id_proveedor || options.provider.idProveedor);
  let busy = false, rows = [], catalog = [], catalogSorted = [], rubros = [], token = '', operation = crypto.randomUUID();
  let catalogReady = false;
  let menu = null, menuInput = null, menuIndex = -1, menuKind = '', matches = [];
  let articlePage = null, articleHasMatch = false;
  const fieldSnapshots = new Map(), undoStack = [];
  let movementId = 0, restoring = false, selectedRowUid = '', selectionAnchor = '';
  const setStatus = (text, error = false, recoverable = false) => {
    statusText.textContent = text;
    status.classList.toggle('error', error);
    reconnect.hidden = !recoverable;
  };
  function saveDraft() {
    if (!catalogReady) return;
    if (!rows.length) { clearDraft(); return; }
    try { localStorage.setItem(draftKey(providerId), JSON.stringify({ operation, rows })); } catch (error) { console.warn('No se pudo guardar el borrador del importador.', error); }
  }
  function clearDraft() {
    try { localStorage.removeItem(draftKey(providerId)); } catch (error) { console.warn('No se pudo borrar el borrador del importador.', error); }
  }
  function loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey(providerId)) || 'null');
      return draft && Array.isArray(draft.rows) && draft.rows.length && draft.rows.every(row => row && typeof row.codigo === 'string' && typeof row.descripcion === 'string') ? draft : null;
    } catch { return null; }
  }
  function hideMenu() { menu?.remove(); menu = null; menuInput = null; menuIndex = -1; menuKind = ''; }
  function close(discard = false) {
    if (busy) return;
    if (discard) clearDraft(); else saveDraft();
    hideMenu(); window.removeEventListener('keydown', handleDialogKeydown, true);
    backdrop.remove(); active = false; returnFocus?.focus?.({ preventScroll:true });
  }
  function changed() { operation = crypto.randomUUID(); saveDraft(); }
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
    return Number.isFinite(value) ? `${value.toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:4 })} %` : '';
  }
  function costDifference(row) {
    const oldCost = Number(row.original?.costo);
    if (!row.original || !Number.isFinite(oldCost) || oldCost <= 0) return '—';
    const difference = (row.costo - oldCost) / oldCost * 100;
    return `${difference > 0 ? '+' : ''}${difference.toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })} %`;
  }
  function summary() {
    const updates = rows.filter(r => r.mode === 'update').length;
    backdrop.querySelector('[data-summary]').textContent = `${rows.length - updates} nuevos · ${updates} para actualizar`;
    apply.disabled = busy || !rows.length || rows.some(r => r.loading || (r.mode === 'update' && !r.id));
  }
  function render() {
    hideMenu();
    backdrop.querySelector('tbody').innerHTML = rows.map((r, i) => `<tr data-row="${i}" class="local-import-row${selectedRowUid === r.uid ? ' local-selected' : ''}">
      <td><input readonly value="${escape(r.mode === 'new' ? 'Automático' : r.id || 'Elegir →')}"></td>
      <td><input readonly value="${escape(r.codigo)}"></td>
      <td><div class="local-articles-combo"><input data-field="descripcion" autocomplete="off" maxlength="100" value="${escape(r.descripcion)}" placeholder="Buscar por código o descripción…"${r.original ? ` title="Costo anterior: ${escape(money(r.original.costo))}"` : ''}><button type="button" data-article-toggle tabindex="-1" title="Buscar artículo">▼</button></div></td>
      <td><div class="local-articles-combo"><input data-field="rubro" autocomplete="off" value="${escape(rubros.find(item => Number(item.id) === Number(r.rubro))?.nombre || '')}" placeholder="Elegir rubro"><button type="button" data-rubro-toggle tabindex="-1" title="Buscar rubro">▼</button></div></td>
      <td><select data-field="iva"><option value="0.21">21 %</option><option value="0.105">10,5 %</option>${![.21,.105].some(v => Math.abs(v-r.iva)<.00001) ? `<option value="${Number(r.iva)}">${Number(r.iva)*100} %</option>` : ''}</select></td>
      <td><input data-field="margen" inputmode="decimal" value="${displayMargin(r.margen)}"></td>
      <td class="num">${money(r.costo)}</td><td class="num">${r.original ? money(r.original.costo) : '—'}</td><td class="num" data-difference>${costDifference(r)}</td>
      <td><button type="button" data-remove title="Quitar">×</button></td>
    </tr>`).join('');
    backdrop.querySelectorAll('tr[data-row]').forEach(tr => {
      const row = rows[Number(tr.dataset.row)];
      tr.querySelector('[data-field="iva"]').value = String([.21,.105].find(v => Math.abs(v-row.iva)<.00001) ?? row.iva);
    });
    summary();
  }
  async function pick(row, id) {
    const sourceInput = menuInput;
    hideMenu(); row.loading = true; row.mode = 'update'; row.id = ''; row.newConfirmed = true; summary();
    const requestId = row.lookup = crypto.randomUUID();
    setStatus('Leyendo los datos actuales del artículo…');
    try {
      const article = await api(`article?id=${encodeURIComponent(id)}`);
      if (!backdrop.isConnected || row.lookup !== requestId || row.mode !== 'update') return;
      row.original = article; row.id = article.id; row.version = article.version;
      row.descripcion = article.descripcion; row.rubro = Number(article.rubro); row.iva = Number(article.iva);
      row.margen = Number(article.margen)*100; row.originalMargin = row.margen;
      if (sourceInput) finishFieldEdit(sourceInput);
      changed(); setStatus('Revisá los datos. El proveedor, código y costo nuevos vienen de la lista seleccionada.');
    } catch (error) { setStatus(error.message, true); }
    finally { row.loading = false; if (backdrop.isConnected) render(); }
  }
  function search(input, row) {
    hideMenu(); menuInput = input; menuKind = 'article';
    const queryText = input.value;
    const query = normalize(queryText);
    const filterRank = article => normalize(article.codigo) === query ? -1 : indexDescriptionFilterRank(article.descripcion, queryText);
    const isMatch = article => Number.isFinite(filterRank(article));
    articleHasMatch = Boolean(query) && catalogSorted.some(isMatch);
    articlePage = window.CorralonSystem.articleOptionPager.create(catalogSorted, {
      key: article => String(article.id),
      description: article => article.descripcion,
      isMatch,
      rank: filterRank,
      hasSearch: Boolean(query), beforeCount:20, afterCount:40, matchLimit:100
    });
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
    menu.addEventListener('click', e => { const button=e.target.closest('[data-match]'); if(button) pick(row,matches[Number(button.dataset.match)].id); });
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
    menu.innerHTML = '<div class="local-articles-search-head" aria-hidden="true"><span>IDArt</span><span>Cód. proveedor</span><span>Descripción</span><span>Proveedor</span></div>' + (matches.length ? matches.map((article,index) => `<button type="button" data-match="${index}" role="option"${index === menuIndex ? ' class="active"' : ''}><span>${escape(article.id)}</span><span title="${escape(article.codigo)}">${escape(article.codigo)}</span><span title="${escape(article.descripcion)}">${escape(article.descripcion)}</span><span title="${escape(article.proveedorNombre || 'Sin nombre')}">${escape(article.proveedorNombre || 'Sin nombre')}</span></button>`).join('') : '<p>Sin coincidencias en la base local.</p>');
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
  function searchRubro(input,row) {
    hideMenu(); menuInput = input; menuKind = 'rubro';
    const query = normalize(input.value);
    matches = rubros.filter(item => normalize(item.nombre).includes(query)).slice(0,80);
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
        if (start >= 0) backdrop.querySelectorAll('tr[data-row]').forEach((element, index) => element.classList.toggle('local-selected', index >= Math.min(start,end) && index <= Math.max(start,end)));
      } else {
        selectedRowUid = current?.uid || '';
        selectionAnchor = selectedRowUid;
        backdrop.querySelectorAll('tr[data-row]').forEach(element => element.classList.toggle('local-selected', element === tr));
      }
    }
  });
  backdrop.addEventListener('focusin', e => {
    if (e.target.matches('[data-field]')) beginFieldEdit(e.target);
    if (e.target.matches('[data-field="descripcion"]')) {
      const snapshot = fieldSnapshots.get(e.target);
      originalDescription.textContent = `Descripción original: ${snapshot?.before.descripcion || e.target.value}`;
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
    if (row && e.target.dataset.field === 'descripcion') confirmNew(row);
    if (row && e.target.dataset.field === 'margen') {
      row.margen = parseMargin(e.target.value);
      if (Number.isFinite(row.margen)) e.target.value = displayMargin(row.margen);
    }
    finishFieldEdit(e.target);
  });
  backdrop.addEventListener('input', e => {
    const input = e.target.closest('[data-field]'); if (!input || busy) return;
    const tr = input.closest('[data-row]'), row = rows[Number(tr.dataset.row)], field = input.dataset.field;
    if (field === 'descripcion') {
      row.descripcion = input.value;
      row.mode = 'new'; row.id = ''; row.original = null; row.version = ''; row.lookup = null;
      row.needsNewConfirmation = true; row.newConfirmed = false; row.declinedDescription = '';
      search(input,row); summary();
      tr.querySelector('td:first-child input').value = 'Automático';
    }
    if (field === 'rubro') {
      const selected = rubros.find(item => normalize(item.nombre) === normalize(input.value));
      row.rubro = selected ? Number(selected.id) : 0;
      searchRubro(input,row);
    }
    if (field === 'margen') row.margen = parseMargin(input.value);
    changed();
  });
  backdrop.addEventListener('change', e => {
    const input = e.target.closest('[data-field]'); if (!input || busy) return;
    const row = rows[Number(input.closest('[data-row]').dataset.row)], field = input.dataset.field;
    if (field === 'iva') {
      row[field]=Number(input.value); changed();
    }
  });
  const editableFields = ['descripcion','rubro','iva','margen'];
  function focusGrid(rowIndex, fieldIndex) {
    if (!rows.length) return;
    if (rowIndex >= rows.length) { apply.focus(); return; }
    if (rowIndex < 0) rowIndex = 0;
    const field = editableFields[Math.max(0, Math.min(editableFields.length-1, fieldIndex))];
    backdrop.querySelector(`tr[data-row="${rowIndex}"] [data-field="${field}"]`)?.focus({ preventScroll:true });
  }
  function moveGrid(input, direction, edge = false) {
    const rowIndex = Number(input.closest('[data-row]').dataset.row);
    const fieldIndex = editableFields.indexOf(input.dataset.field);
    let nextRow = rowIndex, nextField = fieldIndex;
    if (direction === 'up') nextRow = edge ? 0 : rowIndex - 1;
    if (direction === 'down') nextRow = edge ? rows.length-1 : rowIndex + 1;
    if (direction === 'right') {
      if (edge) nextField = editableFields.length-1;
      else if (++nextField >= editableFields.length) { nextField = 0; nextRow++; }
    }
    if (direction === 'left') {
      if (edge) nextField = 0;
      else if (--nextField < 0) { nextField = editableFields.length-1; nextRow--; }
    }
    hideMenu(); focusGrid(nextRow, nextField);
  }
  function atTextEdge(input, direction) {
    if (typeof input.selectionStart !== 'number') return true;
    const all = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    return all || (direction === 'left' ? input.selectionStart === 0 : input.selectionEnd === input.value.length);
  }
  function handleDialogKeydown(e) {
    if (!backdrop.isConnected) return;
    const inDialog = backdrop.contains(e.target) || menu?.contains(e.target);
    if (!inDialog && e.key !== 'Escape') return;
    e.stopPropagation();
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
    if (busy || !inDialog) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); if (!undoField(input)) setStatus('No hay movimientos para deshacer.'); return;
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
    for (const row of rows) if (!confirmNew(row, true)) return;
    const invalid = rows.find(r => (r.mode==='update'&&!r.id) || !r.rubro || !r.descripcion.trim() || !Number.isFinite(r.margen) || r.margen<0 || !(r.costo>0));
    if(invalid) { setStatus('Completá artículo, rubro, costo y margen en todas las filas.',true); return; }
    busy=true; hideMenu(); backdrop.querySelectorAll('button,input,select').forEach(el=>el.disabled=true); apply.textContent='Aplicando…';
    setStatus('Validando y guardando todo el lote en la base local…');
    const payload={ operation, provider:Number(options.provider.id_proveedor || options.provider.idProveedor), rows:rows.map(r=>({ mode:r.mode,id:r.id,version:r.version,codigo:r.codigo,descripcion:r.descripcion,costo:r.costo,rubro:r.rubro,iva:r.iva,margen:r.mode==='update' && Math.abs(r.margen-r.originalMargin)<.000001 ? null : r.margen })) };
    let result;
    try {
      result=await api('apply',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Articles-Token':token},body:JSON.stringify(payload)});
    } catch(error) {
      busy=false; backdrop.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);
      setStatus(error.message,true,true);
      apply.textContent='Aplicar todos'; summary();
      return;
    }
    const appliedRows=rows.map(row=>rowCopy(row));
    const message=`${result.nuevos} artículos nuevos y ${result.actualizados} actualizados en la base local`;
    // Liberar el popup antes de refrescar la tabla principal. Así un error visual
    // posterior nunca puede dejar el importador bloqueado para el próximo uso.
    busy=false; close(true);
    try { options.showMessage?.(message); } catch(error) { console.warn('El lote se guardó; falló el mensaje visual.',error); }
    try { options.onImported?.({...result,importados:result.nuevos+result.actualizados,directSql:true},appliedRows); } catch(error) { console.warn('El lote se guardó; falló la actualización visual.',error); }
  });
  async function refreshConnection() {
    if (busy) return;
    busy=true; reconnect.disabled=true; setStatus('Restableciendo la conexión con SQL Server…');
    try {
      const data=await api('catalog');
      if (!backdrop.isConnected) return;
      token=data.token; catalog=data.articles.map(a=>({...a,search:normalize(`${a.id} ${a.codigo} ${a.descripcion}`)})); rubros=data.rubros;
      catalogSorted=catalog.slice().sort((a,b)=>String(a.descripcion || '').localeCompare(String(b.descripcion || ''),'es',{sensitivity:'base'}) || String(a.id).localeCompare(String(b.id)));
      backdrop.querySelector('[data-provider]').textContent=`${options.provider.proveedor || options.provider.nombre || ''} · ${catalog.length.toLocaleString('es-AR')} artículos leídos desde SQL Server`;
      if (!catalogReady) {
        const draft = loadDraft();
        const counts=new Map(); catalog.filter(a=>Number(a.proveedor)===providerId).forEach(a=>counts.set(Number(a.rubro),(counts.get(Number(a.rubro))||0)+1));
        const defaultRubro=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
        rows=draft ? draft.rows.map(row=>({ ...row, uid:row.uid || crypto.randomUUID(), loading:false, lookup:null }))
          : (options.rows || []).map(source=>({uid:crypto.randomUUID(),mode:'new',id:'',codigo:String(source.codigo || source.cod_proveedor || source.codProveedor || '').trim(),descripcion:String(source.descripcion || source.articulo || '').trim().toLocaleUpperCase('es-AR'),costo:Number(source.costo ?? source.precio_costo ?? source.precioFinal ?? 0),rubro:Number(source.idRubro || source.id_rubro || defaultRubro),iva:.21,margen:30,newConfirmed:true,needsNewConfirmation:false}));
        if (draft?.operation) operation = draft.operation;
        catalogReady=true;
        saveDraft();
        render(); setStatus(draft ? 'Borrador recuperado. Podés seguir donde lo dejaste.' : 'Conexión restablecida. Podés continuar y aplicar el lote.');
      } else {
        render(); setStatus('Conexión restablecida. Podés continuar y aplicar el lote.');
      }
    } catch(error) {
      setStatus(`${error.message} Cerrá y abrí Corralón Local si tampoco responde al reintentar.`,true,true);
    } finally {
      busy=false; reconnect.disabled=false; summary();
    }
  }
  reconnect.addEventListener('click', refreshConnection);
  await refreshConnection();
}
