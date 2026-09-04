// Cache propia: los datos y su cursor se confirman en la misma transacción.
export function createNotificationCache({ collectionName, versionField, timestamp = false, api, onChange, onError }) {
  let rows = new Map();
  let cursor = null;
  let initialized = false;
  let ready;
  let unsubscribe;
  let timer;
  let stopped = true;
  let generation = 0;
  let writes = Promise.resolve();
  const key = collectionName;
  const plain = value => JSON.parse(JSON.stringify(value));
  const version = row => {
    const value = row?.[versionField];
    if (timestamp) return value && Number.isFinite(value.seconds)
      ? { seconds: value.seconds, nanoseconds: value.nanoseconds || 0 } : null;
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  };
  const newer = (a, b) => a != null && (b == null || (timestamp
    ? a.seconds > b.seconds || a.seconds === b.seconds && a.nanoseconds > b.nanoseconds
    : a > b));
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('corralon_menu_notifications_v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('streams');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Caché de notificaciones bloqueada'));
    });
  }
  function persist() {
    const record = { rows: [...rows.values()], cursor, initialized };
    writes = writes.catch(() => {}).then(async () => {
      const db = await database();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('streams', 'readwrite');
          tx.objectStore('streams').put(record, key);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
    });
    writes.catch(onError);
  }
  function load() {
    if (!ready) ready = (async () => {
      try {
        const db = await database();
        try {
          const record = await new Promise((resolve, reject) => {
            const request = db.transaction('streams').objectStore('streams').get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          if (record?.initialized && Array.isArray(record.rows)) {
            rows = new Map(record.rows.map(row => [row.firestoreId, row]));
            cursor = record.cursor;
            initialized = true;
          }
        } finally { db.close(); }
      } catch (error) { onError(error); }
    })();
    return ready;
  }
  function merge(snapshot, full = false) {
    let changed = full;
    const previousCursor = cursor;
    if (full) rows.clear();
    const changes = full ? snapshot.docs.map(doc => ({ doc, type: 'added' })) : snapshot.docChanges({ includeMetadataChanges: true });
    for (const change of changes) {
      // No avanzar el cursor con escrituras locales aún no confirmadas.
      if (change.doc.metadata?.hasPendingWrites) continue;
      const row = { ...plain(change.doc.data()), firestoreId: change.doc.id };
      const next = version(row);
      if (newer(next, cursor)) cursor = next;
      if (change.type === 'removed' || row.eliminado) changed = rows.delete(change.doc.id) || changed;
      else if (JSON.stringify(rows.get(change.doc.id)) !== JSON.stringify(row)) {
        rows.set(change.doc.id, row);
        changed = true;
      }
    }
    initialized = true;
    if (changed || newer(cursor, previousCursor)) persist();
    if (changed) onChange([...rows.values()]);
  }
  function listen(run) {
    if (stopped || run !== generation) return;
    unsubscribe?.();
    // Inclusivo: no perder dos documentos con la misma marca de versión.
    // syncId proviene de equipos clientes: solapar un minuto evita diferencias pequeñas de reloj.
    const boundary = timestamp
      ? new api.Timestamp(cursor?.seconds || 0, cursor?.nanoseconds || 0)
      : Math.max(0, Number(cursor || 0) - 60000000);
    const target = api.query(api.collection(api.db, collectionName), api.where(versionField, '>=', boundary));
    const listeningCursor = cursor;
    unsubscribe = api.onSnapshot(target, { includeMetadataChanges: true }, snapshot => {
      if (stopped || run !== generation || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      merge(snapshot);
    }, error => {
      if (stopped || run !== generation) return;
      onError(error);
      clearTimeout(timer);
      timer = setTimeout(() => listen(run), 15000);
    });
    clearTimeout(timer);
    const rebase = () => {
      if (stopped || run !== generation) return;
      if (newer(cursor, listeningCursor)) listen(run);
      else timer = setTimeout(rebase, 60000);
    };
    timer = setTimeout(rebase, 60000);
  }
  async function start() {
    if (!stopped) return;
    stopped = false;
    const run = ++generation;
    try {
      await load();
      if (stopped || run !== generation) return;
      onChange([...rows.values()], true);
      if (!initialized) {
        const snapshot = await api.getDocsFromServer(api.collection(api.db, collectionName));
        if (stopped || run !== generation) return;
        merge(snapshot, true);
      }
      listen(run);
    } catch (error) {
      if (stopped || run !== generation) return;
      onError(error);
      stopped = true;
      timer = setTimeout(start, 15000);
    }
  }
  function stop() {
    stopped = true;
    generation++;
    clearTimeout(timer);
    unsubscribe?.();
    unsubscribe = null;
  }
  return { start, stop, values: () => [...rows.values()], restore: () => onChange([...rows.values()], true) };
}
