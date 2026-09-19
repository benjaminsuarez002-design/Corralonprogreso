(function () {
  'use strict';

  const core = window.CorralonSystem;
  const cacheDb = window.CorralonCacheDB;
  if (!core || !cacheDb) return;
  const CACHE_KEY = 'pedidos_ranking_articulos_4m_v1';
  const FIELDS = 'idart,ventas_progreso,unidades_progreso,ventas_calle5,unidades_calle5,ultima_venta,sync_version';
  const PAGE_SIZE = 1000;
  let state = { version: 0, rows: [], meta: null };
  let byId = new Map();
  let articles = [];
  let articlePromise = null;
  let syncPromise = null;
  let selectedArticle = null;
  let rankPage = 1;
  let supplierNames = new Map();

  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const norm = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const fmt = (value) => Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const stockText = (value) => value === '' || value == null ? '—' : fmt(value);
  const idOf = (article) => String(article?.codigo ?? article?.idart ?? '').trim();
  const statsFor = (id) => byId.get(String(id || '').trim()) || null;
  const saleCount = (row, branch) => branch === '1' ? Number(row?.ventas_progreso || 0)
    : branch === '2' ? Number(row?.ventas_calle5 || 0)
      : Number(row?.ventas_progreso || 0) + Number(row?.ventas_calle5 || 0);
  const units = (row, branch) => branch === '1' ? Number(row?.unidades_progreso || 0)
    : branch === '2' ? Number(row?.unidades_calle5 || 0)
      : Number(row?.unidades_progreso || 0) + Number(row?.unidades_calle5 || 0);
  const headers = () => core.headers();

  const consult = document.createElement('div');
  consult.id = 'rankingConsultModal';
  consult.className = 'ranking-overlay';
  consult.innerHTML = `<section class="ranking-dialog ranking-consult-dialog" role="dialog" aria-modal="true" aria-labelledby="rankingConsultTitle">
    <header><div><h2 id="rankingConsultTitle">Consultar artículo</h2><small id="rankingOrigin"></small></div><button type="button" data-ranking-close="consult">Cerrar</button></header>
    <div class="ranking-consult-body">
      <label>Buscar artículo de Index<input id="rankingArticleSearch" autocomplete="off" placeholder="Código o descripción"></label>
      <div class="ranking-suggestions" id="rankingSuggestions"></div>
      <div class="ranking-result" id="rankingConsultResult">Elegí un artículo de Index.</div>
    </div>
  </section>`;
  document.body.appendChild(consult);

  const panel = document.createElement('div');
  panel.id = 'rankingPanel';
  panel.className = 'ranking-overlay';
  panel.innerHTML = `<section class="ranking-dialog ranking-panel-dialog" role="dialog" aria-modal="true" aria-labelledby="rankingTitle">
    <header><div><h2 id="rankingTitle">Rotación de artículos</h2><small id="rankingPeriod">Cargando...</small></div><button type="button" data-ranking-close="panel">Cerrar</button></header>
    <div class="ranking-controls">
      <label>Buscar<input id="rankingFilter" autocomplete="off" placeholder="Código o artículo"></label>
      <label>Sucursal<select id="rankingBranch"><option value="">Ambas</option><option value="1">Progreso</option><option value="2">Calle 5</option></select></label>
      <label>Proveedor<div class="ranking-filter-combo" data-ranking-filter-combo="provider"><input id="rankingProvider" data-ranking-filter-input="provider" data-value="" autocomplete="off" value="Todos"><button type="button" data-ranking-filter-drop="provider" tabindex="-1" aria-label="Desplegar proveedores">▼</button><div class="ranking-filter-menu" data-ranking-filter-menu="provider"></div></div></label>
      <label>Rubro<div class="ranking-filter-combo" data-ranking-filter-combo="rubro"><input id="rankingRubro" data-ranking-filter-input="rubro" data-value="" autocomplete="off" value="Todos"><button type="button" data-ranking-filter-drop="rubro" tabindex="-1" aria-label="Desplegar rubros">▼</button><div class="ranking-filter-menu" data-ranking-filter-menu="rubro"></div></div></label>
      <label>Ordenar<select id="rankingSort"><option value="ventas">Más ventas</option><option value="unidades">Más unidades</option></select></label>
      <label class="ranking-zero"><input id="rankingNoSales" type="checkbox"> Sin ventas</label>
    </div>
    <div class="ranking-table-wrap"><table><thead><tr><th>Artículo</th><th>Progreso</th><th>Calle 5</th></tr></thead><tbody id="rankingTableBody"></tbody></table></div>
    <footer><span id="rankingCount"></span><button id="rankingMore" type="button">Ver más</button></footer>
  </section>`;
  document.body.appendChild(panel);

  const filterOptions = { provider: [], rubro: [] };
  const filterMenus = { provider: { active: 0, visible: [] }, rubro: { active: 0, visible: [] } };

  function periodText() {
    const meta = state.meta;
    if (!meta?.ranking_version) return 'Ranking todavía no publicado';
    const date = String(meta.ranking_actualizado_at || '').slice(0, 10);
    return `${meta.ranking_desde || ''} al ${meta.ranking_hasta || ''} · actualizado ${date || 'sin fecha'}`;
  }

  function catalogue() {
    if (articlePromise) return articlePromise;
    articlePromise = core.catalog.load().then((rows) => {
      articles = (Array.isArray(rows) ? rows : []).filter((row) => idOf(row));
      populateFilters();
      return articles;
    }).catch((error) => { articlePromise = null; throw error; });
    return articlePromise;
  }

  function populateFilters() {
    const rubroInput = panel.querySelector('#rankingRubro');
    const providerInput = panel.querySelector('#rankingProvider');
    const rubros = [...new Set(articles.map((a) => String(a.rubro || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const providers = [...new Set(articles.map((a) => String(a.id_proveedor || a.idProveedor || '').trim()).filter(Boolean))]
      .filter((id) => String(supplierNames.get(id) || '').trim())
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    filterOptions.rubro = [{ value: '', label: 'Todos' }, ...rubros.map((rubro) => ({ value: rubro, label: rubro }))];
    filterOptions.provider = [{ value: '', label: 'Todos' }, ...providers.map((id) => ({ value: id, label: supplierNames.get(id) }))];
    for (const [kind, input] of [['provider', providerInput], ['rubro', rubroInput]]) {
      const selected = filterOptions[kind].find((option) => option.value === input.dataset.value) || filterOptions[kind][0];
      input.dataset.value = selected.value;
      input.value = selected.label;
    }
  }

  async function loadSupplierNames() {
    try {
      const rows = await core.faltantes.loadProviderNames();
      const names = new Map();
      for (const row of rows) {
        const internal = String(core.providerIdentity.internalId(row) || '').trim();
        if (!internal || names.has(internal)) continue;
        const name = String(row.proveedor || '').trim();
        if (name) names.set(internal, name);
      }
      supplierNames = names;
      if (articles.length) populateFilters();
    } catch (error) { console.warn('No se pudieron cargar nombres de proveedores para el ranking', error); }
  }

  function closeFilterMenus(except = '') {
    for (const kind of ['provider', 'rubro']) {
      if (kind === except) continue;
      panel.querySelector(`[data-ranking-filter-menu="${kind}"]`)?.classList.remove('visible');
    }
  }

  function renderFilterMenu(kind, showAll = false) {
    const input = panel.querySelector(`[data-ranking-filter-input="${kind}"]`);
    const menu = panel.querySelector(`[data-ranking-filter-menu="${kind}"]`);
    if (!input || !menu) return;
    const query = showAll ? '' : norm(input.value === 'Todos' ? '' : input.value);
    const visible = filterOptions[kind].filter((option) => !query || norm(option.label).includes(query));
    const selectedIndex = visible.findIndex((option) => option.value === input.dataset.value);
    filterMenus[kind].visible = visible;
    filterMenus[kind].active = Math.max(0, selectedIndex);
    menu.innerHTML = visible.length ? visible.map((option, index) => `<button type="button" data-ranking-filter-option="${kind}" data-index="${index}" class="${index === filterMenus[kind].active ? 'active' : ''}">${html(option.label)}</button>`).join('')
      : '<p>Sin coincidencias.</p>';
    closeFilterMenus(kind);
    menu.classList.add('visible');
    menu.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function chooseFilter(kind, index) {
    const option = filterMenus[kind].visible[index];
    const input = panel.querySelector(`[data-ranking-filter-input="${kind}"]`);
    if (!option || !input) return;
    input.dataset.value = option.value;
    input.value = option.label;
    closeFilterMenus();
    rankPage = 1;
    renderRanking();
  }

  function restoreFilterText(kind) {
    const input = panel.querySelector(`[data-ranking-filter-input="${kind}"]`);
    if (!input) return;
    const exact = filterOptions[kind].find((option) => norm(option.label) === norm(input.value));
    if (exact) {
      input.dataset.value = exact.value;
      input.value = exact.label;
      rankPage = 1;
      renderRanking();
      return;
    }
    const selected = filterOptions[kind].find((option) => option.value === input.dataset.value) || filterOptions[kind][0];
    input.value = selected?.label || 'Todos';
  }

  async function fetchMeta() {
    const url = `${core.SUPABASE_URL}/rest/v1/catalogo_articulos_meta?id=eq.principal&select=ranking_version,ranking_desde,ranking_hasta,ranking_actualizado_at&limit=1`;
    const response = await fetch(url, { headers: headers(), cache: 'no-store' });
    if (!response.ok) throw new Error(`Version de ranking: HTTP ${response.status}`);
    const rows = await response.json();
    return rows?.[0] || null;
  }

  async function fetchChanges(after, target) {
    const result = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const where = after > 0 ? `&sync_version=gt.${after}` : '';
      const url = `${core.SUPABASE_URL}/rest/v1/ranking_articulos_4m?select=${FIELDS}${where}&sync_version=lte.${target}&order=sync_version.asc,idart.asc`;
      const response = await fetch(url, { cache: 'no-store',
        // El orden es estable; cada pagina entrega solo siete campos compactos.
        headers: core.headers({ Range: `${offset}-${offset + PAGE_SIZE - 1}` }) });
      if (!response.ok) throw new Error(`Ranking: HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Respuesta de ranking invalida');
      result.push(...rows);
      if (rows.length < PAGE_SIZE) return result;
    }
  }

  async function sync() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const meta = await fetchMeta();
      const target = Number(meta?.ranking_version || 0);
      if (!target) { state.meta = meta; refreshVisible(); return; }
      const full = !state.version || !state.rows.length || state.version > target;
      if (!full && state.version === target) { state.meta = meta; refreshVisible(); return; }
      const changed = await fetchChanges(full ? 0 : state.version, target);
      const merged = new Map((full ? [] : state.rows).map((row) => [String(row.idart), row]));
      changed.forEach((row) => merged.set(String(row.idart), row));
      const next = { version: target, rows: [...merged.values()], meta };
      await cacheDb.set(CACHE_KEY, next);
      state = next;
      byId = merged;
      refreshVisible();
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function displayArticle(article) {
    if (!article) return;
    selectedArticle = article;
    const data = statsFor(idOf(article));
    const stock1 = article.stockSucursalProgresoRuta;
    const stock2 = article.stockSucursalCalle5Espana;
    const sales = (count, quantity) => state.version
      ? `${fmt(count)} ventas / ${fmt(quantity)} unidades`
      : 'Ventas todavía no disponibles';
    consult.querySelector('#rankingConsultResult').innerHTML = `<div class="ranking-article-title">${html(article.nombre || article.descripcion || '')}<small>IDArt ${html(idOf(article))} · Cód. proveedor ${html(article.codprov || article.idartprov || '')}</small></div>
      <div class="ranking-table-wrap"><table><thead><tr><th>Descripción</th><th>Stock Progreso</th><th>Stock Calle 5</th><th>Ventas Progreso</th><th>Ventas Calle 5</th></tr></thead>
      <tbody><tr><td>${html(article.nombre || article.descripcion || '')}</td><td>${stockText(stock1)}</td><td>${stockText(stock2)}</td><td>${sales(data?.ventas_progreso, data?.unidades_progreso)}</td><td>${sales(data?.ventas_calle5, data?.unidades_calle5)}</td></tr></tbody></table></div>
      <small class="ranking-date">${html(periodText())}</small>`;
  }

  function suggest() {
    const input = consult.querySelector('#rankingArticleSearch');
    const target = norm(input.value);
    const words = target.split(' ').filter(Boolean);
    const list = consult.querySelector('#rankingSuggestions');
    if (!target) { list.innerHTML = ''; list.hidden = true; return; }
    const matched = articles.filter((row) => {
      const haystack = norm(`${idOf(row)} ${row.codprov || ''} ${row.nombre || row.descripcion || ''}`);
      return words.every((word) => haystack.includes(word));
    }).sort((a, b) => {
      const exactA = norm(a.codprov) === target || norm(idOf(a)) === target ? 0 : 1;
      const exactB = norm(b.codprov) === target || norm(idOf(b)) === target ? 0 : 1;
      return exactA - exactB || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    }).slice(0, 35);
    list.innerHTML = matched.length ? matched.map((a) => `<button type="button" data-ranking-id="${html(idOf(a))}"><b>${html(idOf(a))}</b><span>${html(a.codprov || '')}</span><strong>${html(a.nombre || a.descripcion || '')}</strong><span class="ranking-stock" title="Stock Progreso">Progreso <b>${stockText(a.stockSucursalProgresoRuta)}</b></span><span class="ranking-stock" title="Stock Calle 5">Calle 5 <b>${stockText(a.stockSucursalCalle5Espana)}</b></span></button>`).join('')
      : '<p>No hay artículos de Index con esa búsqueda.</p>';
    list.hidden = false;
  }

  function rankingRows() {
    const query = norm(panel.querySelector('#rankingFilter').value);
    const branch = panel.querySelector('#rankingBranch').value;
    const provider = panel.querySelector('#rankingProvider').dataset.value || '';
    const rubro = panel.querySelector('#rankingRubro').dataset.value || '';
    const onlyZero = panel.querySelector('#rankingNoSales').checked;
    const sort = panel.querySelector('#rankingSort').value;
    const words = query.split(' ').filter(Boolean);
    return articles.filter((a) => {
      const stats = statsFor(idOf(a));
      const sales = saleCount(stats, branch);
      if (onlyZero ? sales !== 0 : sales <= 0) return false;
      if (provider && String(a.id_proveedor || a.idProveedor || '') !== provider) return false;
      if (rubro && String(a.rubro || '') !== rubro) return false;
      const haystack = norm(`${idOf(a)} ${a.codprov || ''} ${a.nombre || a.descripcion || ''}`);
      return words.every((word) => haystack.includes(word));
    }).sort((a, b) => {
      const left = statsFor(idOf(a)), right = statsFor(idOf(b));
      const value = sort === 'unidades' ? units(right, branch) - units(left, branch) : saleCount(right, branch) - saleCount(left, branch);
      return value || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    });
  }

  function renderRanking() {
    if (!panel.classList.contains('visible')) return;
    panel.querySelector('#rankingPeriod').textContent = periodText();
    if (!articles.length || !state.version) {
      panel.querySelector('#rankingTableBody').innerHTML = `<tr><td colspan="3">${articles.length ? 'Ranking todavía no publicado.' : 'Cargando artículos de Index...'}</td></tr>`;
      panel.querySelector('#rankingCount').textContent = '';
      panel.querySelector('#rankingMore').hidden = true;
      return;
    }
    const filtered = rankingRows();
    const shown = filtered.slice(0, rankPage * 50);
    panel.querySelector('#rankingTableBody').innerHTML = shown.map((a) => {
      const data = statsFor(idOf(a));
      return `<tr data-ranking-article="${html(idOf(a))}"><td><b>${html(a.nombre || a.descripcion || '')}</b><small>${html(idOf(a))} · ${html(a.codprov || '')}</small></td><td>${fmt(data?.ventas_progreso)} ventas / ${fmt(data?.unidades_progreso)} unidades<small>Stock: ${stockText(a.stockSucursalProgresoRuta)}</small></td><td>${fmt(data?.ventas_calle5)} ventas / ${fmt(data?.unidades_calle5)} unidades<small>Stock: ${stockText(a.stockSucursalCalle5Espana)}</small></td></tr>`;
    }).join('') || '<tr><td colspan="3">No hay artículos para esos filtros.</td></tr>';
    panel.querySelector('#rankingCount').textContent = `${shown.length.toLocaleString('es-AR')} de ${filtered.length.toLocaleString('es-AR')} artículos`;
    panel.querySelector('#rankingMore').hidden = shown.length >= filtered.length;
  }

  function refreshVisible() {
    if (selectedArticle && consult.classList.contains('visible')) displayArticle(selectedArticle);
    renderRanking();
  }

  async function openConsult(orderRow, preferredArticle = null) {
    selectedArticle = null;
    consult.querySelector('#rankingOrigin').textContent = `Cód. proveedor: ${orderRow?.codProv || '—'} · ${orderRow?.articulo || ''}`;
    consult.querySelector('#rankingConsultResult').textContent = 'Elegí un artículo de Index.';
    const input = consult.querySelector('#rankingArticleSearch');
    input.value = String(orderRow?.codProv || String(orderRow?.articulo || '').split(/\s+/).slice(0, 3).join(' ')).trim();
    const initialSearch = input.value;
    consult.classList.add('visible');
    input.focus();
    const [catalogResult, rankingResult] = await Promise.allSettled([catalogue(), sync()]);
    if (catalogResult.status === 'fulfilled') {
      if (preferredArticle && input.value === initialSearch) displayArticle(preferredArticle);
      else suggest();
    }
    else { console.warn(catalogResult.reason); consult.querySelector('#rankingConsultResult').textContent = 'No pude cargar los artículos de Index. Volvé a intentar.'; }
    if (rankingResult.status === 'rejected') console.warn('El ranking todavía no está disponible', rankingResult.reason);
  }

  async function openRanking() {
    rankPage = 1;
    panel.classList.add('visible');
    renderRanking();
    try { await Promise.all([catalogue(), sync()]); renderRanking(); }
    catch (error) { console.warn(error); panel.querySelector('#rankingPeriod').textContent = 'No pude actualizar el ranking; se muestra la copia disponible.'; renderRanking(); }
  }

  consult.querySelector('#rankingArticleSearch').addEventListener('input', () => { selectedArticle = null; suggest(); });
  consult.querySelector('#rankingArticleSearch').addEventListener('focus', suggest);
  consult.querySelector('#rankingArticleSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { const first = consult.querySelector('[data-ranking-id]'); if (first) { event.preventDefault(); first.click(); } }
  });
  consult.querySelector('#rankingSuggestions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ranking-id]');
    if (!button) return;
    displayArticle(articles.find((a) => idOf(a) === button.dataset.rankingId));
  });
  for (const input of panel.querySelectorAll('.ranking-controls input:not([data-ranking-filter-input]),.ranking-controls select')) {
    input.addEventListener(input.tagName === 'INPUT' && input.type === 'text' ? 'input' : 'change', () => { rankPage = 1; renderRanking(); });
  }
  for (const kind of ['provider', 'rubro']) {
    const input = panel.querySelector(`[data-ranking-filter-input="${kind}"]`);
    const drop = panel.querySelector(`[data-ranking-filter-drop="${kind}"]`);
    const menu = panel.querySelector(`[data-ranking-filter-menu="${kind}"]`);
    input.addEventListener('focus', () => { input.select(); });
    input.addEventListener('input', () => renderFilterMenu(kind));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'F4') { event.preventDefault(); renderFilterMenu(kind, true); return; }
      if (event.key === 'Escape') { event.preventDefault(); closeFilterMenus(); restoreFilterText(kind); return; }
      if (!menu.classList.contains('visible') && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) renderFilterMenu(kind, true);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const total = filterMenus[kind].visible.length;
        if (!total) return;
        filterMenus[kind].active = Math.max(0, Math.min(total - 1, filterMenus[kind].active + (event.key === 'ArrowDown' ? 1 : -1)));
        menu.querySelectorAll('[data-ranking-filter-option]').forEach((button, index) => button.classList.toggle('active', index === filterMenus[kind].active));
        menu.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!menu.classList.contains('visible')) renderFilterMenu(kind);
        chooseFilter(kind, filterMenus[kind].active);
      }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (!menu.matches(':hover')) { closeFilterMenus(); restoreFilterText(kind); } }, 0));
    drop.addEventListener('mousedown', (event) => event.preventDefault());
    drop.addEventListener('click', () => menu.classList.contains('visible') ? closeFilterMenus() : renderFilterMenu(kind, true));
    menu.addEventListener('mousedown', (event) => event.preventDefault());
    menu.addEventListener('click', (event) => {
      const option = event.target.closest(`[data-ranking-filter-option="${kind}"]`);
      if (option) chooseFilter(kind, Number(option.dataset.index));
    });
  }
  panel.querySelector('#rankingMore').addEventListener('click', () => { rankPage++; renderRanking(); });
  panel.querySelector('#rankingTableBody').addEventListener('click', (event) => {
    const row = event.target.closest('[data-ranking-article]');
    if (row) {
      const article = articles.find((a) => idOf(a) === row.dataset.rankingArticle);
      openConsult({ codProv: '', articulo: row.querySelector('b')?.textContent || '' }, article);
    }
  });
  document.getElementById('rankingBtn')?.addEventListener('click', openRanking);
  for (const overlay of [consult, panel]) {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-ranking-close]')) overlay.classList.remove('visible');
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { consult.classList.remove('visible'); panel.classList.remove('visible'); }
  });
  window.addEventListener('corralon:catalog-meta-changed', (event) => {
    if (Number(event.detail?.rankingVersion || 0) > state.version || !event.detail) sync().catch(console.warn);
  });
  window.addEventListener('focus', () => sync().catch(console.warn));
  window.addEventListener('online', () => sync().catch(console.warn));
  cacheDb.get(CACHE_KEY).then((cached) => {
    if (cached && Array.isArray(cached.rows)) {
      state = cached;
      byId = new Map(cached.rows.map((row) => [String(row.idart), row]));
      refreshVisible();
    }
    return sync();
  }).catch((error) => console.warn('No se pudo iniciar el ranking', error));
  loadSupplierNames();
  window.CorralonPedidosRanking = { openConsult, openRanking, sync };
})();
