import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, query, limit, where, orderBy,
  writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',
  authDomain: 'corralon-progreso.firebaseapp.com',
  projectId: 'corralon-progreso',
  storageBucket: 'corralon-progreso.firebasestorage.app',
  messagingSenderId: '466583614632',
  appId: '1:466583614632:web:42cb839f83e97475fabe9d'
};
const CACHE_KEY = 'tarjetas_planes_cache_v2';
const CURSOR_KEY = 'tarjetas_planes_cursor_v2';
const PENDING_KEY = 'tarjetas_planes_pending_v2';
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const plans = collection(db, 'tarjetasPlanes');
const configRef = doc(db, 'configuracion', 'tarjetasPlanes');
const $ = (selector) => document.querySelector(selector);
const els = {
  cards: $('#cards'), rows: $('#rows'), empty: $('#empty'), modalEmpty: $('#modalEmpty'),
  status: $('#status'), modalStatus: $('#modalStatus'), search: $('#search'),
  addCard: $('#addCard'), addOption: $('#addOption'), rename: $('#renameCard'),
  close: $('#closeModal'), modal: $('#optionsModal'), title: $('#modalTitle'),
  note: $('#adminNote'), printAll: $('#printAll'), printSheet: $('#printSheet'),
  saveAll: $('#saveAll'), saveModal: $('#saveModal')
};
const user = (() => {
  try {
    const persistent = JSON.parse(localStorage.getItem('corralon_menu_active_user_snapshot_v1') || 'null');
    if (persistent?.id) return persistent;
    const temporary = JSON.parse(sessionStorage.getItem('corralon_menu_active_user_session_v1') || 'null');
    return temporary?.usuario?.id ? temporary.usuario : temporary?.id ? temporary : {};
  } catch { return {}; }
})();
const isAdmin = String(user.nivel || '').toLowerCase() === 'administrador';
let data = [];
let selectedCard = '';
let dirtyIds = new Set();
let deletedRows = new Map();
let localSaveTimer = null;
let syncSequence = 0;

const initial = [
  ['visa y master', 'Mercado Pago', '1', '10,00 %', ''],
  ['visa y master', 'Mercado Pago', '2', '12,00 %', ''],
  ['visa y master', 'Mercado Pago', '3', '21,00 %', ''],
  ['visa y master', 'Mercado Pago', '6', '31,00 %', ''],
  ['visa y master', 'Mercado Pago', '12', '10,00 %', 'Seleccionar 12 cuotas al final'],
  ['visa y master', 'Lapos (Payway)', '3', 'Sin interés', 'Miércoles y sábados'],
  ['visa y master', 'Getnet', 'No usar', '', ''],
  ['naranja', 'Mercado Pago', 'No usar', '', ''],
  ['naranja', 'Lapos (Payway)', '1', '7,00 %', ''],
  ['naranja', 'Lapos (Payway)', '3 o Z', '10,00 %', 'Depende del producto; ofrecer sin interés'],
  ['naranja', 'Lapos (Payway)', '5', 'Sin interés', 'Hasta final de septiembre'],
  ['naranja', 'Getnet', 'No usar', '', ''],
  ['data', 'Mercado Pago', 'No usar', '', ''],
  ['data', 'Lapos (Payway)', '1', '21,50 %', 'Usar plan A'],
  ['data', 'Lapos (Payway)', '3', '21,50 %', 'Usar plan D']
];

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function norm(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function label(value) {
  const text = String(value || '').trim();
  return text ? text.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Sin nombre';
}
function nextSyncId() {
  syncSequence = (syncSequence + 1) % 1000;
  return Date.now() * 1000 + syncSequence;
}
function setStatus(text, error = false, modal = false) {
  const target = modal ? els.modalStatus : els.status;
  target.textContent = text;
  target.classList.toggle('error', error);
}
function pendingCount() { return dirtyIds.size + deletedRows.size; }
function paintPending() {
  const count = pendingCount();
  for (const button of [els.saveAll, els.saveModal]) {
    button.disabled = !isAdmin || count === 0;
    button.textContent = count ? `Guardar (${count})` : 'Guardar';
  }
  if (isAdmin) els.note.textContent = count
    ? `${count} ${count === 1 ? 'cambio pendiente' : 'cambios pendientes'}. Se sincronizan únicamente al guardar.`
    : 'Todo guardado. La lista se carga desde la caché y busca solamente movimientos nuevos.';
}
function groups() {
  const map = new Map();
  for (const row of data) {
    const key = norm(row.tarjeta);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { name: String(row.tarjeta).trim(), rows: [] });
    map.get(key).rows.push(row);
  }
  return [...map.values()];
}
function selectedRows() { return data.filter((row) => norm(row.tarjeta) === norm(selectedCard)); }
function renderCards() {
  const filter = norm(els.search.value);
  const items = groups().filter((group) => !filter || norm([group.name, ...group.rows.flatMap((row) => [row.terminal, row.cuotas, row.interes, row.nota])].join(' ')).includes(filter));
  els.empty.hidden = items.length > 0;
  els.cards.innerHTML = items.map((group) => {
    const terminals = [...new Set(group.rows.map((row) => String(row.terminal || '').trim()).filter(Boolean))];
    return `<article class="card" tabindex="0" role="button" data-card="${esc(group.name)}"><span class="card-arrow">›</span><h2>${esc(label(group.name))}</h2><p>${group.rows.length} ${group.rows.length === 1 ? 'opción de cobro' : 'opciones de cobro'}</p><div class="card-terminals">${terminals.map((value) => `<span>${esc(value)}</span>`).join('')}</div></article>`;
  }).join('');
}
function renderModal() {
  if (!selectedCard) return;
  els.title.textContent = label(selectedCard);
  const rows = selectedRows();
  els.modalEmpty.hidden = rows.length > 0;
  els.rows.innerHTML = rows.map((row) => `<tr data-id="${esc(row.id)}"><td data-label="Terminal"><input data-field="terminal" value="${esc(row.terminal)}" ${isAdmin ? '' : 'disabled'}></td><td data-label="Cuotas"><input data-field="cuotas" value="${esc(row.cuotas)}" ${isAdmin ? '' : 'disabled'}></td><td data-label="Interés"><input data-field="interes" value="${esc(row.interes)}" ${isAdmin ? '' : 'disabled'}></td><td data-label="Nota"><input data-field="nota" value="${esc(row.nota)}" ${isAdmin ? '' : 'disabled'}></td><td><button class="delete" data-delete="${esc(row.id)}" ${isAdmin ? '' : 'hidden'}>×</button></td></tr>`).join('');
  paintPending();
}
function renderAll() {
  data.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  renderCards();
  if (selectedCard) renderModal();
  paintPending();
}
function renderPrintSheet() {
  const body = groups().map((group) => {
    const terminals = new Map();
    group.rows.forEach((row) => {
      const key = String(row.terminal || '').trim();
      if (!terminals.has(key)) terminals.set(key, []);
      terminals.get(key).push(row);
    });
    let cardDone = false;
    return [...terminals.entries()].map(([terminal, rows], terminalIndex) => rows.map((row, rowIndex) => {
      const cardCell = cardDone ? '' : `<td class="print-card" rowspan="${group.rows.length}">${esc(label(group.name))}</td>`;
      cardDone = true;
      const terminalCell = rowIndex ? '' : `<td class="print-terminal" rowspan="${rows.length}">${esc(terminal)}</td>`;
      return `<tr class="${terminalIndex === 0 && rowIndex === 0 ? 'card-start' : ''}">${cardCell}${terminalCell}<td class="print-installments">${esc(row.cuotas)}</td><td class="print-interest">${esc(row.interes)}</td><td class="print-note">${esc(row.nota)}</td></tr>`;
    }).join('')).join('');
  }).join('');
  els.printSheet.innerHTML = `<div class="print-title"><img src="logo-corralon.png" alt=""><h1>Tarjetas y opciones de cobro</h1><span class="print-subtitle">Corralón Progreso</span></div><table class="print-table"><colgroup><col style="width:18%"><col style="width:19%"><col style="width:12%"><col style="width:14%"><col style="width:37%"></colgroup><thead><tr><th>Tarjetas</th><th>Posnet</th><th>Cuotas</th><th>Interés</th><th>Nota</th></tr></thead><tbody>${body}</tbody></table>`;
}
function openCard(name) {
  selectedCard = name;
  renderModal();
  els.modal.classList.add('visible');
  setStatus(`${selectedRows().length} opciones`, false, true);
}
function closeModal() { els.modal.classList.remove('visible'); selectedCard = ''; renderCards(); }
async function persistLocal() {
  clearTimeout(localSaveTimer);
  await Promise.all([
    window.CorralonCacheDB.set(CACHE_KEY, data),
    window.CorralonCacheDB.set(PENDING_KEY, { dirty: [...dirtyIds], deleted: [...deletedRows.values()] })
  ]);
}
function queueLocalSave() {
  clearTimeout(localSaveTimer);
  localSaveTimer = setTimeout(() => persistLocal().catch(console.warn), 120);
}
function markDirty(row) {
  if (!row?.id) return;
  dirtyIds.add(row.id);
  deletedRows.delete(row.id);
  paintPending();
  queueLocalSave();
}
function mergeRemoteRows(changes, full = false) {
  const base = full ? data.filter((row) => dirtyIds.has(row.id)) : data;
  const map = new Map(base.map((row) => [row.id, row]));
  for (const change of changes) {
    if (dirtyIds.has(change.id) || deletedRows.has(change.id)) continue;
    if (change.eliminado) map.delete(change.id);
    else map.set(change.id, { ...(map.get(change.id) || {}), ...change });
  }
  data = [...map.values()];
}
async function downloadChanges(forceFull = false) {
  setStatus('Buscando actualizaciones…');
  try {
    let cursor = Number(await window.CorralonCacheDB.get(CURSOR_KEY) || 0);
    const full = forceFull || !cursor;
    const snapshot = full
      ? await getDocs(plans)
      : await getDocs(query(plans, where('syncId', '>', cursor), orderBy('syncId', 'asc')));
    const changes = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    mergeRemoteRows(changes, full);
    const maxSync = changes.reduce((max, row) => Math.max(max, Number(row.syncId || 0)), cursor);
    cursor = full ? (maxSync || 1) : maxSync;
    await Promise.all([
      window.CorralonCacheDB.set(CACHE_KEY, data),
      window.CorralonCacheDB.set(CURSOR_KEY, cursor)
    ]);
    renderAll();
    setStatus(changes.length ? `${changes.length} movimientos descargados` : 'La lista ya está actualizada');
  } catch (error) {
    console.warn(error);
    setStatus('No se pudieron descargar las actualizaciones. Se mantiene la caché local.', true);
  }
}
async function seedOnce() {
  const marker = await getDoc(configRef);
  if (marker.exists() && marker.data()?.inicializado) return;
  const existing = await getDocs(query(plans, limit(1)));
  const batch = writeBatch(db);
  if (existing.empty) initial.forEach((values, index) => {
    const [tarjeta, terminal, cuotas, interes, nota] = values;
    batch.set(doc(plans, `inicial_${String(index + 1).padStart(2, '0')}`), {
      tarjeta, terminal, cuotas, interes, nota, orden: index + 1,
      eliminado: false, syncId: nextSyncId(), updatedAt: serverTimestamp(),
      updatedBy: String(user.nombre || user.usuario || 'Sistema')
    });
  });
  batch.set(configRef, { inicializado: true, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}
async function savePending() {
  if (!isAdmin || !pendingCount()) return;
  clearTimeout(localSaveTimer);
  for (const button of [els.saveAll, els.saveModal]) button.disabled = true;
  setStatus('Guardando cambios…');
  setStatus('Guardando cambios…', false, true);
  try {
    const batch = writeBatch(db);
    const assignedSyncIds = new Map();
    for (const id of dirtyIds) {
      const row = data.find((item) => item.id === id);
      if (!row) continue;
      const syncId = nextSyncId();
      assignedSyncIds.set(id, syncId);
      batch.set(doc(plans, id), {
        tarjeta: String(row.tarjeta || '').trim(), terminal: String(row.terminal || '').trim(),
        cuotas: String(row.cuotas || '').trim(), interes: String(row.interes || '').trim(),
        nota: String(row.nota || '').trim(), orden: Number(row.orden) || 0,
        eliminado: false, syncId, updatedAt: serverTimestamp(),
        updatedBy: String(user.nombre || user.usuario || 'Administrador')
      }, { merge: true });
    }
    for (const [id, row] of deletedRows) {
      const syncId = nextSyncId();
      assignedSyncIds.set(id, syncId);
      batch.set(doc(plans, id), {
        tarjeta: String(row.tarjeta || '').trim(), eliminado: true, syncId,
        updatedAt: serverTimestamp(), updatedBy: String(user.nombre || user.usuario || 'Administrador')
      }, { merge: true });
    }
    await batch.commit();
    data = data.map((row) => assignedSyncIds.has(row.id) ? { ...row, syncId: assignedSyncIds.get(row.id), _isNew: false } : row);
    dirtyIds.clear();
    deletedRows.clear();
    await Promise.all([
      window.CorralonCacheDB.set(CACHE_KEY, data),
      window.CorralonCacheDB.set(PENDING_KEY, { dirty: [], deleted: [] })
    ]);
    renderAll();
    setStatus('Cambios guardados en Firebase');
    setStatus('Cambios guardados', false, true);
  } catch (error) {
    console.warn(error);
    setStatus('No se pudieron guardar. Los cambios siguen en la caché local.', true);
    setStatus('No se pudieron guardar. Podés volver a intentar.', true, true);
    paintPending();
  }
}

els.cards.addEventListener('click', (event) => {
  const card = event.target.closest('[data-card]');
  if (card) openCard(card.dataset.card);
});
els.cards.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-card]')) {
    event.preventDefault(); openCard(event.target.dataset.card);
  }
});
els.rows.addEventListener('input', (event) => {
  const input = event.target.closest('[data-field]');
  if (!input || !isAdmin) return;
  const row = data.find((item) => item.id === input.closest('tr')?.dataset.id);
  if (!row) return;
  row[input.dataset.field] = input.value;
  markDirty(row);
});
els.rows.addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button || !isAdmin || !confirm('¿Eliminar esta opción de cobro?')) return;
  const row = data.find((item) => item.id === button.dataset.delete);
  if (!row) return;
  data = data.filter((item) => item.id !== row.id);
  dirtyIds.delete(row.id);
  if (!row._isNew) deletedRows.set(row.id, row);
  renderAll();
  queueLocalSave();
});
els.addOption.addEventListener('click', () => {
  if (!isAdmin || !selectedCard) return;
  const row = { id: doc(plans).id, tarjeta: selectedCard, terminal: 'Terminal', cuotas: '1', interes: '', nota: '', orden: Math.max(0, ...data.map((item) => Number(item.orden) || 0)) + 1, _isNew: true };
  data.push(row); markDirty(row); renderAll();
  setTimeout(() => els.rows.querySelector(`[data-id="${row.id}"] input`)?.focus(), 30);
});
els.addCard.addEventListener('click', () => {
  if (!isAdmin) return;
  const name = prompt('Nombre de la tarjeta:', '');
  if (!String(name || '').trim()) return;
  const row = { id: doc(plans).id, tarjeta: String(name).trim(), terminal: 'Terminal', cuotas: '1', interes: '', nota: '', orden: Math.max(0, ...data.map((item) => Number(item.orden) || 0)) + 1, _isNew: true };
  data.push(row); markDirty(row); renderAll(); openCard(row.tarjeta);
});
els.rename.addEventListener('click', () => {
  if (!isAdmin || !selectedCard) return;
  const next = prompt('Nuevo nombre:', selectedCard);
  if (!String(next || '').trim() || norm(next) === norm(selectedCard)) return;
  for (const row of selectedRows()) { row.tarjeta = String(next).trim(); markDirty(row); }
  selectedCard = String(next).trim(); renderAll();
});
els.close.addEventListener('click', closeModal);
els.modal.addEventListener('mousedown', (event) => { if (event.target === els.modal) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && els.modal.classList.contains('visible')) closeModal(); });
els.search.addEventListener('input', renderCards);
els.printAll.addEventListener('click', () => { renderPrintSheet(); window.print(); });
els.saveAll.addEventListener('click', savePending);
els.saveModal.addEventListener('click', savePending);

if (!isAdmin) {
  els.addCard.hidden = true; els.addOption.hidden = true; els.rename.hidden = true;
  els.saveAll.hidden = true; els.saveModal.hidden = true; els.note.textContent = 'Modo consulta';
}

try {
  data = await window.CorralonCacheDB.get(CACHE_KEY) || [];
  const pending = await window.CorralonCacheDB.get(PENDING_KEY) || {};
  dirtyIds = new Set(Array.isArray(pending.dirty) ? pending.dirty : []);
  deletedRows = new Map((Array.isArray(pending.deleted) ? pending.deleted : []).map((row) => [row.id, row]));
  renderAll();
  await seedOnce();
  await downloadChanges(false);
} catch (error) {
  console.warn(error);
  renderAll();
  setStatus('Se cargó la caché local, pero falló la actualización.', true);
}
