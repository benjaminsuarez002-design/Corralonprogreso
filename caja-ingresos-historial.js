function initializeCashHistory(totalsMode) {
  'use strict';
  const prefix = totalsMode ? 'cashTotals' : 'cashHistory';
  const button = document.getElementById(prefix + 'Btn');
  if (!button) return;
  const style = document.createElement('style');
  style.textContent = `
    #cashHistoryModal{z-index:70}
    #cashHistoryModal .modal{width:min(1400px,96vw);height:90vh;display:flex;flex-direction:column}
    .cash-history-filters{display:flex;gap:12px;align-items:end;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--borde)}
    .cash-history-filters label{display:block;font-weight:700;margin-bottom:4px}
    .cash-history-filters select{min-width:180px;padding:6px;border:1px solid var(--borde);font:inherit;background:#fff}
    .cash-history-date{display:flex;position:relative}
    .cash-history-date input[type=text]{width:155px;padding:6px;border:1px solid var(--borde);font:inherit}
    .cash-history-calendar{position:absolute;right:0;bottom:0;width:30px;height:30px;opacity:0;pointer-events:none}
    .cash-history-table{flex:1;overflow:auto;margin:0 16px;border:1px solid var(--borde)}
    .cash-history-table table{width:100%;table-layout:auto}
    .cash-history-table th{position:sticky;top:0;z-index:1;background:var(--panel-soft);cursor:pointer;white-space:nowrap}
    .cash-history-table td{padding:3px 7px;white-space:nowrap}
    .cash-history-table td.cash-history-note{white-space:normal;min-width:220px}
    .cash-history-table tr.cash-history-selected td{background:#dcecff}
    .cash-history-status{padding:8px 16px;min-height:32px}
    .cash-history-totals{display:flex;gap:24px;justify-content:flex-end;flex-wrap:wrap;padding:14px 16px;font-weight:800}
    #cashHistoryModal [role=status]{color:#555}
    #cashHistoryModal [hidden]{display:none!important}
    .cash-history-print-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .cash-history-check{width:30px;text-align:center}
    @media(max-width:650px){#cashHistoryModal{padding:6px}.cash-history-filters{gap:8px}.cash-history-date input[type=text]{width:125px}.cash-history-totals{gap:12px}}
  `;
  if (totalsMode) style.textContent = style.textContent.replaceAll('cashHistory', 'cashTotals');
  document.head.appendChild(style);
  const popup = document.createElement('div');
  popup.id = 'cashHistoryModal'; popup.className = 'modal-bg';
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-labelledby', 'cashHistoryTitle');
  popup.innerHTML = `<section class="modal">
    <div class="modal-head"><h2 class="modal-title" id="cashHistoryTitle">Ingresos y egresos</h2><div class="cash-history-print-actions"><button class="access-btn primary" id="cashHistoryPrint" type="button">Imprimir</button><button class="access-btn" id="cashHistoryPrintCancel" type="button" hidden>Cancelar selección</button><button class="access-btn small" id="cashHistoryClose" type="button">Cerrar</button></div></div>
    <form class="cash-history-filters" id="cashHistoryFilters">
      <div><label for="cashHistoryStart">Desde</label><div class="cash-history-date"><input id="cashHistoryStart" type="text" autocomplete="off" placeholder="dd/mm/aaaa" data-history-nav><button class="access-btn" type="button" data-calendar="cashHistoryStart" tabindex="-1" aria-label="Calendario desde">▾</button><input class="cash-history-calendar" id="cashHistoryStartCalendar" type="date" tabindex="-1" aria-label="Fecha desde"></div></div>
      <div><label for="cashHistoryEnd">Hasta</label><div class="cash-history-date"><input id="cashHistoryEnd" type="text" autocomplete="off" placeholder="dd/mm/aaaa" data-history-nav><button class="access-btn" type="button" data-calendar="cashHistoryEnd" tabindex="-1" aria-label="Calendario hasta">▾</button><input class="cash-history-calendar" id="cashHistoryEndCalendar" type="date" tabindex="-1" aria-label="Fecha hasta"></div></div>
      <div><label for="cashHistoryBranch">Sucursal</label><select id="cashHistoryBranch" data-history-nav></select></div>
      <button class="access-btn primary" type="submit" id="cashHistorySearch" data-history-nav>Consultar</button>
    </form>
    <div class="cash-history-status" id="cashHistoryStatus" role="status" aria-live="polite"></div>
    <div class="cash-history-table"><table><thead><tr><th class="cash-history-check" id="cashHistoryCheckHead" hidden><input type="checkbox" id="cashHistoryCheckAll" aria-label="Seleccionar todos para imprimir"></th><th data-history-sort="date">Fecha</th><th data-history-sort="hour">Hora</th><th data-history-sort="id">Nº movimiento</th><th data-history-sort="branch">Sucursal</th><th data-history-sort="note">Nota</th><th data-history-sort="income">Ingreso</th><th data-history-sort="expense">Egreso</th></tr></thead><tbody id="cashHistoryRows"></tbody></table></div>
    <div class="cash-history-totals" id="cashHistoryTotals"></div>
  </section>`;
  if (totalsMode) {
    popup.id = 'cashTotalsModal';
    popup.innerHTML = popup.innerHTML.replaceAll('cashHistory', 'cashTotals').replace('Ingresos y egresos</h2>', 'Totales entre fechas</h2>');
    popup.setAttribute('aria-labelledby', 'cashTotalsTitle');
  }
  document.body.appendChild(popup);
  const get = id => document.getElementById(id.replace('cashHistory', prefix));
  const totalColumns = [ ['cash','Efectivo'], ['mercadoPago','Mercado Pago'], ['transfers','Transferencia'], ['lapos','Lapos'], ['getnet','Getnet'], ['providerTransfers','Trans a prov'], ['daily','Total Caja Diaria'] ];
  if (totalsMode) get('cashHistoryCheckHead').parentElement.innerHTML = `<th class="cash-history-check" id="cashTotalsCheckHead" hidden><input type="checkbox" id="cashTotalsCheckAll" aria-label="Seleccionar todos para imprimir"></th><th data-history-sort="date">Fecha</th><th data-history-sort="branch">Sucursal</th>` + totalColumns.map(([key,label]) => `<th data-history-sort="${key}">${label}</th>`).join('');
  let sequence = 0, reportRows = [], sort = { field: 'date', direction: 1 }, selected = new Set(), anchor = -1;
  let printMode = false, printExcluded = new Set(), reportRange = '';
  let allReportRows = [];
  function printRowKey(row) { return JSON.stringify([row.date, row.idRecibo || '', row.id]); }
  function printableRows() { return reportRows.filter(row => !printExcluded.has(printRowKey(row))); }
  function historyTotals(rows) {
    const income = rows.reduce((sum, row) => sum + row.income, 0), expense = rows.reduce((sum, row) => sum + row.expense, 0);
    return { income, expense, balance: income - expense };
  }
  function updatePrintControls() {
    const count = printableRows().length;
    get('cashHistoryCheckHead').hidden = !printMode;
    get('cashHistoryPrintCancel').hidden = !printMode;
    get('cashHistoryPrint').textContent = printMode ? `Imprimir seleccionados (${count})` : 'Imprimir';
    get('cashHistoryPrint').disabled = get('cashHistorySearch').disabled || !reportRows.length || (printMode && !count);
    get('cashHistoryCheckAll').checked = count === reportRows.length && count > 0;
    get('cashHistoryCheckAll').indeterminate = count > 0 && count < reportRows.length;
  }
  function drawTotals() {
    const rows = printMode ? printableRows() : reportRows, totals = historyTotals(rows);
    if (totalsMode) {
      get('cashHistoryTotals').innerHTML = `<span>${rows.length} registros${printMode ? ' seleccionados' : ''}</span>` + totalColumns.map(([key,label]) => `<span>${label}: ${formatMoney(rows.reduce((sum,row) => sum + row[key],0))}</span>`).join('');
      return;
    }
    get('cashHistoryTotals').innerHTML = `<span>${rows.length} ${printMode ? 'seleccionados para imprimir' : 'movimientos'}</span><span class="cash-movement-positive">Ingresos: ${formatMoney(totals.income)}</span><span class="cash-movement-negative">Egresos: ${formatMoney(totals.expense)}</span><span>Saldo: ${formatMoney(totals.balance)}</span>`;
  }
  function printHistory() {
    if (totalsMode && !cajaTotalsAllowed) return;
    if (!printMode) { printMode = true; printExcluded.clear(); drawHistory(); return; }
    const rows = printableRows();
    if (!rows.length) return;
    const page = window.open('', '_blank');
    if (!page) { get('cashHistoryStatus').textContent = 'Permití las ventanas emergentes para imprimir.'; return; }
    const totals = historyTotals(rows);
    const printRange = reportRange + ' · ' + (get('cashHistoryBranch').selectedOptions[0]?.textContent || 'Todas las sucursales');
    if (totalsMode) {
      const headings = '<th>Fecha</th><th>Sucursal</th>' + totalColumns.map(([,label]) => `<th>${label}</th>`).join('');
      const body = rows.map(row => `<tr>${totalRowCells(row)}</tr>`).join('');
      const footer = totalColumns.map(([key,label]) => `<span>${label}: ${escapeHtml(formatMoney(rows.reduce((sum,row) => sum + row[key],0)))}</span>`).join('');
      page.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Totales entre fechas</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px}thead{display:table-header-group}.money{text-align:right;white-space:nowrap}tr{break-inside:avoid}footer{display:flex;gap:15px;flex-wrap:wrap;margin-top:15px;font-weight:bold}</style></head><body><h1>Corralón Progreso · Totales entre fechas</h1><p>${escapeHtml(printRange)}</p><table><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table><footer>${footer}</footer></body></html>`);
      page.onload = () => { page.focus(); page.print(); }; page.document.close(); return;
    }
    const body = rows.map(row => `<tr><td>${escapeHtml(formatDateLabel(row.date).replace(' - Hoy', ''))}</td><td>${escapeHtml(row.hour)}</td><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.branch)}</td><td class="note">${escapeHtml(row.note)}</td><td class="money">${row.income ? escapeHtml(formatMoney(row.income)) : ''}</td><td class="money">${row.expense ? escapeHtml(formatMoney(row.expense)) : ''}</td></tr>`).join('');
    page.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ingresos y egresos · ${escapeHtml(printRange)}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#111}h1{font-size:20px;margin:0 0 6px}p{margin:0 0 16px}table{width:100%;border-collapse:collapse}thead{display:table-header-group}th,td{padding:5px 6px;border:1px solid #bbb;text-align:left;vertical-align:top}th{background:#eee}tr{break-inside:avoid}.money{text-align:right;white-space:nowrap}.note{white-space:pre-wrap;overflow-wrap:anywhere}.totals{margin-top:16px;border-top:2px solid #111;padding-top:10px;display:flex;gap:25px;justify-content:flex-end;flex-wrap:wrap;font-size:13px;font-weight:bold;break-inside:avoid}</style></head><body><h1>Corralón Progreso · Ingresos y egresos</h1><p>${escapeHtml(printRange)}</p><table><thead><tr><th>Fecha</th><th>Hora</th><th>Nº movimiento</th><th>Sucursal</th><th>Nota</th><th>Ingreso</th><th>Egreso</th></tr></thead><tbody>${body}</tbody></table><footer class="totals"><span>${rows.length} movimientos</span><span>Ingresos: ${escapeHtml(formatMoney(totals.income))}</span><span>Egresos: ${escapeHtml(formatMoney(totals.expense))}</span><span>Saldo: ${escapeHtml(formatMoney(totals.balance))}</span></footer></body></html>`);
    page.onload = () => { page.focus(); page.print(); };
    page.document.close();
  }

  function parseHistoryDate(value, now = new Date()) {
    const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const weekday = weekdays.indexOf(normalizarTexto(value));
    if (weekday >= 0) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      date.setDate(date.getDate() - (date.getDay() - weekday + 7) % 7);
      return { date, text: date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) };
    }
    return window.CorralonFunciones.parseFechaFlexible(value, now);
  }
  function normalizeDate(input) {
    const parsed = parseHistoryDate(input.value);
    input.setCustomValidity(parsed ? '' : 'Ingresá una fecha válida.');
    if (parsed) { input.value = parsed.text; get(input.id + 'Calendar').value = dateKeyFromDate(parsed.date); }
    return parsed;
  }
  function localRows(date) {
    if (date === selectedDateKey) return state.cashMovements;
    try { return JSON.parse(localStorage.getItem(storageKeyForDate(date)) || 'null')?.cashMovements || []; }
    catch (_) { return []; }
  }
  function rowsForDate(date, cached) {
    if (totalsMode) return totalsForDate(date, cached);
    const local = localRows(date);
    const rows = cached?.ingresosEgresos !== undefined ? cashMovementRowsFromPayload(cached.ingresosEgresos) : local;
    const overrides = new Map(local.filter(row => row.branchManual).map((row, index) => [cashMovementKey(row, index), row.branchId]));
    return rows.map((row, index) => {
      const branchId = overrides.get(cashMovementKey(row, index)) || row.branchId;
      return { ...row, date, branchId, branch: cashMovementBranches().find(branch => branch.id === branchId)?.label || 'Sin asignar', income: Math.max(0, row.amount), expense: Math.max(0, -row.amount) };
    }).filter(row => !cajaRestricted || row.branchId === cajaRestrictedBranchId);
  }
  function renderHistory(days, caches) {
    reportRange = `${formatDateLabel(days[0]).replace(' - Hoy', '')} al ${formatDateLabel(days.at(-1)).replace(' - Hoy', '')}`;
    allReportRows = days.flatMap(date => rowsForDate(date, caches.get(date)));
    applyBranchFilter();
  }
  function totalsForDate(date, cached) {
    let local;
    try { local = date === selectedDateKey ? state : JSON.parse(localStorage.getItem(storageKeyForDate(date)) || 'null'); } catch (_) {}
    const payload = cached?.movimientos;
    const groups = payload?.branches || local?.movementsByBranch;
    const branches = cashMovementBranches();
    let entries = groups ? Object.entries(groups).filter(([id]) => id !== CAJA_ALL_BRANCHES_ID && id !== CAJA_GLOBAL_ONLY_BRANCH_ID) : [];
    const loose = Array.isArray(payload) ? payload : payload?.rows;
    if (!entries.length && (loose || local?.movements)) entries = [[window.CorralonSystem?.BRANCHES?.[0]?.id || 'progreso_ruta', loose || local.movements]];
    const global = payload?.globalOnlyRows || groups?.[CAJA_GLOBAL_ONLY_BRANCH_ID];
    if (Array.isArray(global) && global.length) entries.push(['', global]);
    return entries.filter(([id]) => !cajaRestricted || id === cajaRestrictedBranchId).map(([branchId, group]) => {
      const movements = (Array.isArray(group) ? group : group?.rows || []).map(row => ({...row}));
      if (payload && cached?.ingresosEgresos !== undefined && branchId) {
        const efectivo = movements.find(row => movementTypeKey(row.type || row.tipo || row.TipoPago) === movementTypeKey('Efectivo'));
        if (efectivo) efectivo.ie = rowsForCashTotals(date, cached).filter(row => row.branchId === branchId).reduce((sum,row) => sum + Number(row.amount || 0),0);
      }
      if (payload && Array.isArray(global) && cached?.recibos !== undefined) {
        receiptRowsFromPayload(cached.recibos).filter(receipt => branches.some(branch => branch.id === receipt.branchId)).forEach(receipt => {
          if (branchId && branchId !== receipt.branchId) return;
          (receipt.payments || []).forEach(payment => {
            const type = movementTypeKey(payment.type);
            let row = movements.find(row => movementTypeKey(row.type || row.tipo || row.TipoPago) === type);
            if (!row) { row = {type:payment.type, initial:0, day:0, ie:0}; movements.push(row); }
            row.day = Number(row.day ?? row.movDia ?? row.Importe ?? 0) + Number(payment.amount || 0) * (branchId ? 1 : -1);
          });
        });
      }
      const final = type => movements.filter(row => movementTypeKey(row.type || row.tipo || row.TipoPago) === movementTypeKey(type)).reduce((sum,row) => sum + Number(row.initial ?? row.inicial ?? row.ImpAnt ?? 0) + Number(row.day ?? row.movDia ?? row.Importe ?? 0) + Number(row.ie ?? row.impIE ?? row.ImpRet ?? 0),0);
      return { date, id: branchId || '__global__', branchId, branch: branches.find(branch => branch.id === branchId)?.label || 'Sin asignar', hour:'', income:0, expense:0,
        cash:final('Efectivo'), mercadoPago:final('Mercado Pago'), transfers:final('Transf. Bria.'), lapos:final('Lapos'), getnet:final('Get Net'), providerTransfers:final('Transf prov'),
        daily:movements.filter(row => movementTypeKey(row.type || row.tipo || row.TipoPago) !== movementTypeKey('Cta. Cte.')).reduce((sum,row) => sum + Number(row.day ?? row.movDia ?? row.Importe ?? 0),0) };
    });
  }
  function rowsForCashTotals(date, cached) {
    return cashMovementRowsFromPayload(cached.ingresosEgresos);
  }
  function totalRowCells(row) {
    return `<td>${escapeHtml(formatDateLabel(row.date).replace(' - Hoy',''))}</td><td>${escapeHtml(row.branch)}</td>` + totalColumns.map(([key]) => `<td class="money">${formatMoney(row[key])}</td>`).join('');
  }
  function applyBranchFilter() {
    const branch = get('cashHistoryBranch').value;
    reportRows = allReportRows.filter(row => !branch || (branch === '__unassigned__' ? !row.branchId : String(row.branchId) === branch));
    selected.clear(); anchor = -1;
    drawHistory();
  }
  function drawHistory() {
    reportRows.sort((a, b) => {
      const x = a[sort.field], y = b[sort.field];
      const diff = typeof x === 'number' ? x - y : String(x || '').localeCompare(String(y || ''), 'es', { numeric: true });
      return sort.direction * diff || a.date.localeCompare(b.date) || a.hour.localeCompare(b.hour);
    });
    get('cashHistoryRows').innerHTML = reportRows.length ? reportRows.map((row, index) => `<tr data-history-row="${index}" tabindex="0" class="${selected.has(index) ? 'cash-history-selected' : ''}">${printMode ? `<td class="cash-history-check"><input type="checkbox" data-history-print-row="${index}" aria-label="Imprimir movimiento ${escapeHtml(row.id)}" ${printExcluded.has(printRowKey(row)) ? '' : 'checked'}></td>` : ''}<td>${escapeHtml(formatDateLabel(row.date).replace(' - Hoy', ''))}</td><td>${escapeHtml(row.hour)}</td><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.branch)}</td><td class="cash-history-note">${escapeHtml(row.note)}</td><td class="money cash-movement-positive">${row.income ? formatMoney(row.income) : ''}</td><td class="money cash-movement-negative">${row.expense ? formatMoney(row.expense) : ''}</td></tr>`).join('') : `<tr><td colspan="${printMode ? 8 : 7}">No hay ingresos ni egresos en estas fechas.</td></tr>`;
    if (totalsMode) get('cashHistoryRows').innerHTML = reportRows.length ? reportRows.map((row,index) => `<tr data-history-row="${index}" tabindex="0">${printMode ? `<td class="cash-history-check"><input type="checkbox" data-history-print-row="${index}" aria-label="Imprimir totales" ${printExcluded.has(printRowKey(row)) ? '' : 'checked'}></td>` : ''}${totalRowCells(row)}</tr>`).join('') : `<tr><td colspan="${printMode ? 10 : 9}">No hay totales en estas fechas.</td></tr>`;
    drawTotals(); updatePrintControls();
  }
  async function fetchHistoryPublications(filter, fields) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_CAJA_PUBLICACIONES}?${filter}&select=${fields}&order=fecha.asc&limit=500&offset=${offset}`, { headers: supabaseHeaders(), cache: 'no-store' });
      if (!response.ok) { const error = new Error(await response.text()); error.status = response.status; throw error; }
      const page = await response.json(); rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  async function syncHistory(days, caches, request) {
    const specs = totalsMode ? [['movimientos','movimientos','movimientos'],['ingresos_egresos','ingresosEgresos','cashMovements'],['recibos','recibos','receipts']] : [['ingresos_egresos','ingresosEgresos','cashMovements']];
    const filter = `fecha=gte.${days[0]}&fecha=lte.${days.at(-1)}`;
    let publications;
    try { publications = await fetchHistoryPublications(filter, 'fecha,version,' + specs.map(([section]) => section + '_version').join(',')); }
    catch (error) { if (error.status !== 400) throw error; publications = await fetchHistoryPublications(filter, 'fecha,version'); }
    if (request !== sequence) return;
    let loaded = 0;
    for (const [sectionName,cacheSection,versionKey] of specs) {
    const versionField = sectionName + '_version';
    const changed = publications.filter(item => {
      const cached = caches.get(item.fecha);
      return cached?.[cacheSection] === undefined || Number(cached.versions?.[versionKey] || 0) !== Number(item[versionField] || item.version || 0);
    });
    for (let offset = 0; offset < changed.length; offset += 100) {
      const chunk = changed.slice(offset, offset + 100);
      const sections = await fetchHistoryPublications(`fecha=in.(${chunk.map(item => item.fecha).join(',')})`, `fecha,${sectionName}`);
      if (request !== sequence) return;
      for (const item of chunk) {
        const section = sections.find(row => row.fecha === item.fecha);
        if (!section) continue;
        // Leer de nuevo para conservar las otras secciones si Caja actualizó
        // su caché mientras se consultaba el historial.
        const cached = await readCajaRemoteCache(item.fecha) || {};
        const value = { ...cached, [cacheSection]: section[sectionName], versions: { ...cached.versions, [versionKey]: Number(item[versionField] || item.version || 0) } };
        await writeCajaRemoteCache(item.fecha, value);
        caches.set(item.fecha, value); loaded++;
      }
      renderHistory(days, caches);
      get('cashHistoryStatus').textContent = `Actualizando ${loaded} secciones…`;
    }
    }
    // Archivos anteriores al uso de Supabase: leer Firebase una sola vez
    // cuando no existe una copia local. Esta consulta nunca escribe en Firebase.
    for (const date of days.filter(date => !usesSupabaseCaja(date) && caches.get(date)?.[totalsMode ? 'movimientos' : 'ingresosEgresos'] === undefined)) {
      if (request !== sequence) return;
      let rows = totalsMode ? null : localRows(date);
      if (!rows?.length) {
        const db = firebaseDatabase();
        if (!db) throw new Error('No se pudo consultar el archivo histórico.');
        const snapshot = await db.collection(FIREBASE_CAJA_ESTADOS_COLLECTION).doc(date).get();
        const data = snapshot.exists ? snapshot.data() : null;
        const payload = data?.payload || (data?.payloadJson ? JSON.parse(data.payloadJson) : null);
        rows = totalsMode ? (payload?.movementsByBranch ? {branches:payload.movementsByBranch} : payload?.movements || []) : payload?.cashMovements || [];
      }
      const previous = await readCajaRemoteCache(date) || {};
      const cached = { ...previous, [totalsMode ? 'movimientos' : 'ingresosEgresos']: rows, versions: { ...previous.versions, [totalsMode ? 'movimientos' : 'cashMovements']: 0 } };
      await writeCajaRemoteCache(date, cached); caches.set(date, cached);
    }
    if (request !== sequence) return;
    renderHistory(days, caches);
    const unpublished = days.filter(date => usesSupabaseCaja(date) && !publications.some(item => item.fecha === date)).length;
    get('cashHistoryStatus').textContent = `${formatDateLabel(days[0]).replace(' - Hoy', '')} al ${formatDateLabel(days.at(-1)).replace(' - Hoy', '')} · ${loaded ? `${loaded} secciones actualizadas` : 'Caché al día'}${unpublished ? ` · ${unpublished} días sin publicación` : ''}`;
  }
  async function loadHistory() {
    if (totalsMode && !cajaTotalsAllowed) return;
    const start = normalizeDate(get('cashHistoryStart')), end = normalizeDate(get('cashHistoryEnd'));
    if (!start || !end) { get(!start ? 'cashHistoryStart' : 'cashHistoryEnd').reportValidity(); return; }
    const from = dateKeyFromDate(start.date), until = dateKeyFromDate(end.date);
    if (from > until) { get('cashHistoryStatus').textContent = 'La fecha Desde debe ser anterior o igual a Hasta.'; return; }
    if (cajaRestricted && (from !== TODAY_DATE_KEY || until !== TODAY_DATE_KEY)) return;
    const request = ++sequence, days = [];
    printMode = false; printExcluded.clear();
    for (let date = from; date <= until; date = addDaysToKey(date, 1)) days.push(date);
    const caches = new Map();
    get('cashHistoryStatus').textContent = 'Cargando copia local…';
    get('cashHistorySearch').disabled = true;
    updatePrintControls();
    try {
      await Promise.all(days.map(async date => { const cached = await readCajaRemoteCache(date); if (cached) caches.set(date, cached); }));
      if (request !== sequence) return;
      renderHistory(days, caches);
      get('cashHistoryStatus').textContent = 'Mostrando copia local · buscando cambios…';
      await syncHistory(days, caches, request);
    } catch (error) {
      if (request === sequence) get('cashHistoryStatus').textContent = `Mostrando copia local. No se pudo sincronizar: ${error.message}`;
      console.warn('Historial de ingresos y egresos:', error);
    } finally { if (request === sequence) { get('cashHistorySearch').disabled = false; updatePrintControls(); } }
  }
  function closeHistory() { sequence++; popup.classList.remove('open'); button.focus(); }
  button.addEventListener('click', () => {
    if (totalsMode && !cajaTotalsAllowed) return;
    popup.classList.add('open');
    const branches = cashMovementBranches().filter(branch => !cajaRestricted || branch.id === cajaRestrictedBranchId);
    get('cashHistoryBranch').innerHTML = (cajaRestricted ? '' : '<option value="">Todas las sucursales</option>') + branches.map(branch => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.label)}</option>`).join('') + (cajaRestricted ? '' : '<option value="__unassigned__">Sin asignar</option>');
    get('cashHistoryBranch').value = cajaRestricted ? cajaRestrictedBranchId : '';
    get('cashHistoryBranch').disabled = cajaRestricted;
    for (const id of ['cashHistoryStart', 'cashHistoryEnd']) {
      get(id).value = formatDateLabel(TODAY_DATE_KEY).replace(' - Hoy', '');
      get(id).disabled = cajaRestricted; get(id + 'Calendar').value = TODAY_DATE_KEY;
      popup.querySelector(`[data-calendar="${get(id).id}"]`).disabled = cajaRestricted;
    }
    sort = { field: 'date', direction: 1 };
    get('cashHistoryClose').focus(); loadHistory();
  });
  if (totalsMode) window.addEventListener('menu-user-validated', () => {
    if (!cajaTotalsAllowed) {
      sequence++;
      popup.classList.remove('open');
    }
  });
  get('cashHistoryClose').addEventListener('click', closeHistory);
  get('cashHistoryBranch').addEventListener('change', applyBranchFilter);
  get('cashHistoryPrint').addEventListener('click', printHistory);
  get('cashHistoryPrintCancel').addEventListener('click', () => { printMode = false; printExcluded.clear(); drawHistory(); });
  get('cashHistoryFilters').addEventListener('submit', event => { event.preventDefault(); loadHistory(); });
  popup.addEventListener('click', event => {
    if (event.target.closest('input[type=checkbox]')) return;
    if (event.target === popup) { closeHistory(); return; }
    const calendarButton = event.target.closest('[data-calendar]');
    if (calendarButton) { const calendar = get(calendarButton.dataset.calendar + 'Calendar'); try { calendar.showPicker(); } catch (_) { calendar.focus(); calendar.click(); } return; }
    const header = event.target.closest('[data-history-sort]');
    if (header) { sort = { field: header.dataset.historySort, direction: sort.field === header.dataset.historySort ? -sort.direction : 1 }; selected.clear(); drawHistory(); return; }
    const row = event.target.closest('[data-history-row]');
    if (row) {
      const index = Number(row.dataset.historyRow);
      if (printMode) {
        const key = printRowKey(reportRows[index]);
        if (printExcluded.has(key)) printExcluded.delete(key); else printExcluded.add(key);
        const checkbox = row.querySelector('[data-history-print-row]');
        if (checkbox) checkbox.checked = !printExcluded.has(key);
        drawTotals(); updatePrintControls();
        return;
      }
      if (event.shiftKey && anchor >= 0) for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) selected.add(i);
      else if (event.ctrlKey || event.metaKey) { if (selected.has(index)) selected.delete(index); else selected.add(index); anchor = index; }
      else { selected = new Set([index]); anchor = index; }
      popup.querySelectorAll('[data-history-row]').forEach(item => item.classList.toggle('cash-history-selected', selected.has(Number(item.dataset.historyRow))));
    }
  });
  popup.addEventListener('change', event => {
    if (event.target.id === get('cashHistoryCheckAll').id) {
      printExcluded = event.target.checked ? new Set() : new Set(reportRows.map(printRowKey));
      drawHistory(); get('cashHistoryCheckAll').focus();
    } else if (event.target.matches('[data-history-print-row]')) {
      const row = reportRows[Number(event.target.dataset.historyPrintRow)];
      if (!row) return;
      if (event.target.checked) printExcluded.delete(printRowKey(row)); else printExcluded.add(printRowKey(row));
      drawTotals(); updatePrintControls();
    }
  });
  for (const id of ['cashHistoryStart', 'cashHistoryEnd']) {
    get(id).addEventListener('blur', () => normalizeDate(get(id)));
    get(id).addEventListener('input', () => get(id).setCustomValidity(''));
    get(id + 'Calendar').addEventListener('change', () => { get(id).value = formatDateLabel(get(id + 'Calendar').value).replace(' - Hoy', ''); get(id).setCustomValidity(''); get(id).focus(); });
  }
  window.CorralonFunciones.bindLabelSelect({ root: popup });
  window.CorralonFunciones.bindLinearNavigation({ root: get('cashHistoryFilters'), selector: '[data-history-nav]', navigateLeftRight: true, smartCaret: true, selectOnAnyFocus: true, selectOnFirstPointerFocus: true });
  popup.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (event.target.matches('input[type=text]')) { cancelEdit(event); }
      else { event.preventDefault(); closeHistory(); }
    }
    // Los atajos de este popup no deben actuar sobre las tablas de Caja.
    event.stopPropagation();
  });
}
initializeCashHistory();
initializeCashHistory(true);
