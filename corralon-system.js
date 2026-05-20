(function () {
  const SUPABASE_URL = 'https://tizyjenayrcdkcodsjnc.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpenlqZW5heXJjZGtjb2Rzam5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzE4MDYsImV4cCI6MjA4NzgwNzgwNn0.Xue8zgo8QJiKTErtzfUOgpczMngsAaePJZqLvA8Z7oI';
  const TABLES = {
    providers: 'proveedores',
    providersMeta: 'proveedores_meta',
    priceList: 'lista_precios',
    priceListMeta: 'lista_precios_meta'
  };
  const PROVIDERS_DB = 'proveedores_cache_v1';

  function headers(extra = {}) {
    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...extra
    };
  }

  function norm(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function parseMoney(value) {
    let text = String(value ?? '').replace(/\$/g, '').replace(/\s/g, '');
    if (!text) return 0;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    return Number(text.replace(/[^0-9.-]/g, '')) || 0;
  }

  function cleanId(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    return text ? text.replace(/\.0+$/, '') : '';
  }

  function idVariants(value) {
    const id = cleanId(value);
    if (!id) return [];
    const noZeros = id.replace(/^0+/, '') || '0';
    return [...new Set([id, noZeros])];
  }

  function dateOnly(value) {
    if (!value) return null;
    const date = new Date(value);
    const out = Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
    return out || null;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function nowTimestamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function percent(value) {
    return `${(Number(value || 0) * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function money(value) {
    return `$ ${Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function getByHeader(obj, names) {
    const keys = Object.keys(obj || {});
    for (const name of names) {
      const exact = keys.find((key) => key === name);
      if (exact) return obj[exact];
      const loose = keys.find((key) => norm(key) === norm(name));
      if (loose) return obj[loose];
    }
    return '';
  }

  function providerFromObject(obj) {
    const provider = {
      id_proveedor: String(getByHeader(obj, ['ID Proveedor', 'id_proveedor', 'idprov'])).trim(),
      proveedor: String(getByHeader(obj, ['Proveedor', 'proveedor'])).trim(),
      descuento_factura: Number(getByHeader(obj, ['Descuento En Factura', 'descuento_factura'])) || 0,
      descuento_lista: Number(getByHeader(obj, ['Descuento En Lista', 'descuento_lista'])) || 0,
      ultima_actualizacion: dateOnly(getByHeader(obj, ['Ultima actualizacion', 'ultima_actualizacion'])),
      vendedor: String(getByHeader(obj, ['Vendedor', 'vendedor'])).trim(),
      telefono: String(getByHeader(obj, ['Numero de Telefono', 'telefono'])).trim(),
      nota: String(getByHeader(obj, ['Nota', 'nota'])).trim(),
      porc_flete: Number(getByHeader(obj, ['Porc.Flete', 'porc_flete'])) || 0,
      porc_iva: Number(getByHeader(obj, ['Porc.IVA', 'porc_iva'])) || 0,
      iva_incluido: Boolean(getByHeader(obj, ['Iva Incluido?', 'iva_incluido'])),
      descuento_total_fc: Number(getByHeader(obj, ['Descuento En Total FC', 'descuento_total_fc'])) || null
    };
    provider.proveedor_norm = norm(provider.proveedor);
    return provider.id_proveedor && provider.proveedor ? provider : null;
  }

  function openDb(name, upgrade, version = 1) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => upgrade(request.result, request.transaction);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function openProvidersDb() {
    return openDb(PROVIDERS_DB, (database) => {
      if (!database.objectStoreNames.contains('data')) database.createObjectStore('data', { keyPath: 'id_proveedor' });
    });
  }

  async function getProvidersCache() {
    const database = await openProvidersDb();
    return new Promise((resolve, reject) => {
      const request = database.transaction('data').objectStore('data').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function setProvidersCache(data) {
    const database = await openProvidersDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('data', 'readwrite');
      const store = tx.objectStore('data');
      store.clear();
      data.forEach((item) => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function putProviderCacheItem(item) {
    const database = await openProvidersDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('data', 'readwrite');
      tx.objectStore('data').put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function fetchAll(table, query) {
    let from = 0;
    const out = [];
    while (true) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: headers({ Range: `${from}-${from + 999}` }) });
      if (!response.ok) throw new Error(await response.text());
      const part = await response.json();
      out.push(...part);
      if (part.length < 1000) return out;
      from += 1000;
    }
  }

  async function importProvidersCloud() {
    const providers = await fetchAll(TABLES.providers, 'select=*&order=proveedor.asc');
    if (providers.length) await setProvidersCache(providers);
    return providers;
  }

  async function uploadProviders(data, fileName = '') {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providers}?id_proveedor=not.is.null`, { method: 'DELETE', headers: headers() });
    for (let i = 0; i < data.length; i += 1000) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providers}?on_conflict=id_proveedor`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(data.slice(i, i + 1000))
      });
      if (!response.ok) throw new Error(await response.text());
    }
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providersMeta}?on_conflict=id`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ id: 'principal', version: Date.now(), total_proveedores: data.length, archivo_nombre: fileName })
    });
    await setProvidersCache(data);
  }

  async function updateProviderDateOnly(provider, timestamp = nowTimestamp()) {
    const value = timestamp;
    const updated = { ...provider, ultima_actualizacion: value };
    await putProviderCacheItem(updated);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providers}?id_proveedor=eq.${encodeURIComponent(provider.id_proveedor)}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ ultima_actualizacion: value })
    });
    if (!response.ok) throw new Error(await response.text());
    return value;
  }

  async function touchPriceListMeta() {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?on_conflict=id`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ id: 'principal', lista_version: Date.now() })
    });
    if (!response.ok) throw new Error(await response.text());
  }

  async function replaceProviderArticles(providerId, articles) {
    const del = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceList}?id_proveedor=eq.${encodeURIComponent(providerId)}`, { method: 'DELETE', headers: headers() });
    if (!del.ok) throw new Error(await del.text());
    for (let i = 0; i < articles.length; i += 1000) {
      const chunk = articles.slice(i, i + 1000).map((article, n) => ({
        ...article,
        idorden: Date.now() * 1000 + i + n,
        articulo_source: 'actualizar_articulos'
      }));
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceList}?on_conflict=idorden`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(chunk)
      });
      if (!response.ok) throw new Error(await response.text());
    }
    await touchPriceListMeta();
  }

  function xmlCell(value, type = 'String') {
    const text = String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<Cell><Data ss:Type="${type}">${text}</Data></Cell>`;
  }

  function buildArticlesXlsBlob(articles) {
    const headers = ['IDArt', 'CodProveedor', 'Articulo', 'CodBarra', 'PrecioCosto', 'preciolista', 'PrecioVta', 'IDProveedor', 'IDRubro', 'IDMoneda', 'Nota', 'PorcIVA'];
    const rows = [headers, ...articles.map((article) => [
      '',
      article.cod_proveedor || '',
      article.articulo || '',
      '',
      Number(article.precio_costo || 0),
      '',
      '',
      article.id_proveedor || '',
      '',
      '',
      '',
      ''
    ])];

    if (window.XLSX) {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Hoja1');
      const output = XLSX.write(workbook, { bookType: 'biff8', type: 'array' });
      return new Blob([output], { type: 'application/vnd.ms-excel' });
    }

    const out = [
      '<?xml version="1.0"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Worksheet ss:Name="Hoja1"><Table>',
      '<Row>' + headers.map((header) => xmlCell(header)).join('') + '</Row>'
    ];
    for (const article of articles) {
      out.push(
        '<Row>',
        xmlCell(''),
        xmlCell(article.cod_proveedor || ''),
        xmlCell(article.articulo || ''),
        xmlCell(''),
        xmlCell(Number(article.precio_costo || 0), 'Number'),
        xmlCell(''),
        xmlCell(''),
        xmlCell(article.id_proveedor || ''),
        xmlCell(''),
        xmlCell(''),
        xmlCell(''),
        xmlCell(''),
        '</Row>'
      );
    }
    out.push('</Table></Worksheet></Workbook>');
    return new Blob([out.join('')], { type: 'application/vnd.ms-excel;charset=utf-8' });
  }

  async function saveBlobAs(blob, fileName) {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Excel 97-2003', accept: { 'application/vnd.ms-excel': ['.xls'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }

  const FALTANTES = (() => {
    const INDEX_CACHE_KEY = 'corralon_index_lista_articulos_cache_v1';
    const LIST_DB = 'corralon_lista_proveedores_v1';
    const PROVIDER_LIST_META_KEY = 'corralon_lista_proveedores_meta_v1';
    const LOCAL_KEY = 'corralon_faltantes_rows_v2';
    const COLLECTION = 'faltantes';
    const FIREBASE_CONFIG = {
      apiKey: 'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',
      authDomain: 'corralon-progreso.firebaseapp.com',
      projectId: 'corralon-progreso',
      storageBucket: 'corralon-progreso.firebasestorage.app',
      messagingSenderId: '466583614632',
      appId: '1:466583614632:web:42cb839f83e97475fabe9d'
    };
    let firebaseDb = null;

    function searchNorm(value) {
      return norm(value)
        .replace(/([0-9]+)([a-z]+)/g, '$1 $2')
        .replace(/([a-z]+)([0-9]+)/g, '$1 $2')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function makeLocalUid() {
      return crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function blankRow(columnFiltro = '', source = 'index') {
      return {
        id: '',
        localUid: makeLocalUid(),
        idart: '',
        idProveedor: '',
        codProv: '',
        filtro: columnFiltro,
        proveedor: '',
        descripcion: '',
        cantidad: '',
        precioCosto: 0,
        precioFinal: 0,
        pedido: false,
        source
      };
    }

    function isBlank(row) {
      return !String(row?.idart || row?.codProv || row?.descripcion || row?.cantidad || '').trim() && !row?.pedido;
    }

    function withSearch(row) {
      row.idartNorm = searchNorm(row.idart);
      row.idProveedorNorm = searchNorm(row.idProveedor);
      row.codProvNorm = searchNorm(row.codProv);
      row.proveedorNorm = searchNorm(row.proveedor);
      row.descripcionNorm = searchNorm(row.descripcion);
      return row;
    }

    function normalizeIndexItem(item, index = 0) {
      const firstNumber = (...values) => {
        for (const value of values) {
          if (value === null || value === undefined || value === '') continue;
          const number = Number(value);
          if (Number.isFinite(number)) return number;
        }
        return 0;
      };
      const idart = String(item.idArt || item.IDArt || item.id || item.codigo || item._codigoArticulo || index + 1).trim();
      const descripcion = String(item.descripcion || item.Descripcion || item.nombre || item.articulo || item._descripcionPrincipal || '').trim();
      const precioCosto = firstNumber(
        item.PrecioCpraSISDto,
        item.precioCpraSISDto,
        item.precio_cpra_sis_dto,
        item.precioCosto,
        item.precio_costo,
        item.PrecioCosto,
        item.costo,
        item.Costo,
        item.precio
      );
      const precioFinal = firstNumber(item.precioFinal, item.precioVigente, item.PrecioVta, item.precio, precioCosto);
      const codProv = String(
        item.idartprov || item.idArtProv || item.idart_prov || item.id_art_prov || item.artprov || item.idProveedorArticulo ||
        item.codprov || item.codProv || item.cod_prov || item.codigo_proveedor || item.codigoProveedor || item.codigo_prov ||
        item.codProveedor || item.CodProveedor || item.CodProveed || ''
      ).trim();
      return withSearch({
        source: 'index',
        idart,
        idProveedor: cleanId(item.id_proveedor || item.idProveedor || item.IDProveedor || item.idproveedor || item.idProveed || item.IDProveed || item.idproveed || item.idprov || ''),
        codProv,
        filtro: String(item.filtro || ''),
        proveedor: String(item.proveedor || item.Proveedor || item.nombreProveedor || item.NombreProveedor || item.proveedor_nombre || item.nombre_proveedor || '').trim(),
        descripcion,
        precioCosto,
        precioFinal
      });
    }

    function normalizeProviderArticle(item) {
      return withSearch({
        source: 'proveedores',
        idart: String(item.idart || item.idorden || '').padStart(6, '0'),
        codProv: String(item.cod_proveedor || '').trim(),
        filtro: String(item.filtro || ''),
        proveedor: String(item.proveedor || '').trim(),
        descripcion: String(item.articulo || '').trim(),
        precioCosto: Number(item.precio_costo || 0),
        precioFinal: Number(item.precio_final || item.precio_costo || 0)
      });
    }

    function rowFromRemote(item) {
      return {
        id: item.id || '',
        localUid: item.local_uid || makeLocalUid(),
        idart: item.idart || '',
        idProveedor: item.id_proveedor || item.idProveedor || '',
        codProv: item.cod_proveedor || '',
        filtro: item.filtro || '',
        proveedor: item.proveedor || '',
        descripcion: item.descripcion || '',
        cantidad: item.cantidad ?? '',
        precioCosto: Number(item.precio_costo || 0),
        precioFinal: Number(item.precio_final || 0),
        pedido: Boolean(item.pedido),
        source: item.origen || 'index'
      };
    }

    function rowToRemote(row, orden = 0) {
      if (!row.localUid) row.localUid = makeLocalUid();
      return {
        local_uid: row.localUid,
        idart: row.idart || '',
        id_proveedor: row.idProveedor || '',
        cod_proveedor: row.codProv || '',
        filtro: row.filtro || '',
        proveedor: row.proveedor || '',
        descripcion: row.descripcion || '',
        cantidad: Number(row.cantidad || 0),
        precio_costo: Number(row.precioCosto || 0),
        precio_final: Number(row.precioFinal || 0),
        pedido: Boolean(row.pedido),
        origen: row.source || '',
        orden,
        updatedAt: window.firebase?.firestore?.FieldValue?.serverTimestamp ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now()
      };
    }

    function localFiltroKey() {
      return `${LOCAL_KEY}_filtro`;
    }

    function loadLocalRows() {
      try {
        return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') || [];
      } catch {
        return [];
      }
    }

    function saveLocalRows(rows, columnFiltro = '') {
      localStorage.setItem(localFiltroKey(), String(columnFiltro || ''));
      localStorage.setItem(LOCAL_KEY, JSON.stringify(rows || []));
    }

    function loadColumnFiltro() {
      return localStorage.getItem(localFiltroKey()) || '';
    }

    function firebaseDatabase() {
      if (firebaseDb) return firebaseDb;
      if (!window.firebase?.firestore) return null;
      if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
      firebaseDb = window.firebase.firestore();
      return firebaseDb;
    }

    function firebaseRowFromDoc(doc) {
      return rowFromRemote({ id: doc.id, ...doc.data() });
    }

    async function loadRemoteRows() {
      const db = firebaseDatabase();
      if (!db) return [];
      const snap = await db.collection(COLLECTION).orderBy('orden', 'asc').get();
      return snap.docs.map(firebaseRowFromDoc);
    }

    function subscribeRows(onRows, onError = console.warn) {
      const db = firebaseDatabase();
      if (!db) return null;
      return db.collection(COLLECTION).orderBy('orden', 'asc').onSnapshot(
        (snapshot) => onRows(snapshot.docs.map(firebaseRowFromDoc)),
        onError
      );
    }

    async function saveRows(rows) {
      const db = firebaseDatabase();
      if (!db) return;
      const filled = (rows || []).filter((row) => !isBlank(row));
      if (!filled.length) return;
      const batch = db.batch();
      filled.forEach((row, index) => {
        if (!row.localUid) row.localUid = makeLocalUid();
        batch.set(db.collection(COLLECTION).doc(row.localUid), rowToRemote(row, index), { merge: true });
      });
      await batch.commit();
    }

    async function addRow(row) {
      const item = {
        ...blankRow(row?.filtro || '', row?.source || 'proveedores'),
        ...row,
        localUid: row?.localUid || makeLocalUid(),
        pedido: Boolean(row?.pedido)
      };
      const localRows = loadLocalRows();
      localRows.push(item);
      saveLocalRows(localRows, loadColumnFiltro());
      const db = firebaseDatabase();
      if (db) await db.collection(COLLECTION).doc(item.localUid).set(rowToRemote(item, Date.now()), { merge: true });
      return item;
    }

    async function deleteRowsByUid(uids) {
      const db = firebaseDatabase();
      const valid = [...(uids || [])].filter(Boolean);
      if (!db || !valid.length) return;
      const batch = db.batch();
      valid.forEach((uid) => batch.delete(db.collection(COLLECTION).doc(uid)));
      await batch.commit();
    }

    async function readIndexCache() {
      try {
        const raw = JSON.parse(localStorage.getItem(INDEX_CACHE_KEY) || 'null');
        const rows = (Array.isArray(raw?.data) ? raw.data : []).map(normalizeIndexItem).filter((item) => item.descripcion || item.idart);
        const enrichedRows = await enrichIndexProviders(rows);
        return enrichedRows;
      } catch (error) {
        console.warn(error);
        return [];
      }
    }

    async function enrichIndexProviders(rows) {
      try {
        let providers = await getProvidersCache();
        if (!providers.length) {
          try {
            providers = await importProvidersCloud();
          } catch (error) {
            console.warn(error);
            providers = [];
          }
        }
        if (!providers.length) return rows;
        const providerMap = new Map();
        for (const provider of providers) {
          const name = String(provider.proveedor || '').trim();
          for (const id of idVariants(provider.id_proveedor)) providerMap.set(id, name);
        }
        for (const row of rows) {
          if (row.idProveedor) {
            row.proveedor = idVariants(row.idProveedor).map((id) => providerMap.get(id)).find(Boolean) || row.proveedor || '';
            withSearch(row);
          }
        }
        return rows;
      } catch (error) {
        console.warn(error);
        return rows || [];
      }
    }

    async function readIndexRemote() {
      try {
        const db = firebaseDatabase();
        if (!db) return [];
        const snap = await db.collection('config').doc('listaActual').get();
        const url = snap.exists ? String(snap.data()?.url || '').trim() : '';
        if (!url) return [];
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        if (!Array.isArray(data) || !data.length) return [];
        localStorage.setItem(INDEX_CACHE_KEY, JSON.stringify({ url, savedAt: Date.now(), data }));
        return enrichIndexProviders(data.map(normalizeIndexItem).filter((item) => item.descripcion || item.idart));
      } catch (error) {
        console.warn(error);
        return [];
      }
    }

    async function readIndexRemoteIfChanged() {
      try {
        const db = firebaseDatabase();
        if (!db) return null;
        const snap = await db.collection('config').doc('listaActual').get();
        const url = snap.exists ? String(snap.data()?.url || '').trim() : '';
        if (!url) return null;
        const raw = JSON.parse(localStorage.getItem(INDEX_CACHE_KEY) || 'null');
        if (raw?.url === url && Array.isArray(raw?.data) && raw.data.length) return null;
        return readIndexRemote();
      } catch (error) {
        console.warn(error);
        return null;
      }
    }

    function openListDb() {
      return openDb(LIST_DB, (database, transaction) => {
        let store;
        if (!database.objectStoreNames.contains('articulos')) store = database.createObjectStore('articulos', { keyPath: 'idorden' });
        else store = transaction.objectStore('articulos');
        if (!store.indexNames.contains('id_proveedor')) store.createIndex('id_proveedor', 'id_proveedor', { unique: false });
        if (!store.indexNames.contains('proveedor')) store.createIndex('proveedor', 'proveedor', { unique: false });
        if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'id' });
      }, 3);
    }

    async function readProviderArticlesCache() {
      try {
        const database = await openListDb();
        return await new Promise((resolve, reject) => {
          const request = database.transaction('articulos').objectStore('articulos').getAll();
          request.onsuccess = () => resolve((request.result || []).map(normalizeProviderArticle).filter((item) => item.descripcion || item.idart));
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.warn(error);
        return [];
      }
    }

    async function remoteProviderListMeta() {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?id=eq.principal&select=lista_version,total_articulos,archivo_nombre,updated_at&limit=1`, {
        headers: headers()
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json())?.[0] || null;
    }

    function localProviderListMeta() {
      try {
        return JSON.parse(localStorage.getItem(PROVIDER_LIST_META_KEY) || 'null');
      } catch {
        return null;
      }
    }

    function setLocalProviderListMeta(meta) {
      if (meta) localStorage.setItem(PROVIDER_LIST_META_KEY, JSON.stringify({ id: 'principal', ...meta }));
    }

    function timestampValue(value) {
      if (!value) return 0;
      const text = String(value).trim();
      const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text) ? text.replace(' ', 'T') : text;
      const date = new Date(normalized);
      if (!Number.isNaN(date.getTime())) return date.getTime();
      const day = new Date(text.slice(0, 10));
      return Number.isNaN(day.getTime()) ? 0 : day.getTime();
    }

    async function providerCacheHasRows() {
      try {
        const database = await openListDb();
        return await new Promise((resolve, reject) => {
          const request = database.transaction('articulos').objectStore('articulos').count();
          request.onsuccess = () => resolve(request.result > 0);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.warn(error);
        return false;
      }
    }

    async function replaceProviderArticlesCache(rows, meta) {
      const database = await openListDb();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('articulos', 'readwrite');
        const store = tx.objectStore('articulos');
        store.clear();
        rows.forEach((row) => store.put(row));
        tx.oncomplete = () => {
          setLocalProviderListMeta({ ...meta, last_provider_sync_at: new Date().toISOString(), last_provider_sync_date: today() });
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    }

    async function replaceProviderArticlesCacheBlock(providerId, rows) {
      const database = await openListDb();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('articulos', 'readwrite');
        const store = tx.objectStore('articulos');
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (String(cursor.value?.id_proveedor || '') === String(providerId)) cursor.delete();
            cursor.continue();
            return;
          }
          rows.forEach((row) => store.put(row));
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function fetchProvidersUpdatedAfter(lastSyncAt) {
      const providers = await fetchAll(TABLES.providers, 'select=id_proveedor,proveedor,ultima_actualizacion,updated_at&order=updated_at.asc');
      const lastValue = timestampValue(lastSyncAt);
      return (providers || []).filter((provider) => {
        const providerValue = timestampValue(provider.updated_at || provider.ultima_actualizacion);
        return provider.id_proveedor && providerValue && (!lastValue || providerValue > lastValue);
      });
    }

    async function fetchProviderArticles(providerId) {
      return fetchAll(
        TABLES.priceList,
        `select=idorden,cod_proveedor,articulo,precio_costo,id_proveedor,proveedor,cod_proveedor_norm,articulo_norm,proveedor_norm&id_proveedor=eq.${encodeURIComponent(providerId)}&order=idorden.asc`
      );
    }

    async function downloadProviderArticlesCloud(meta) {
      const rows = await fetchAll(TABLES.priceList, `select=idorden,cod_proveedor,articulo,precio_costo,id_proveedor,proveedor,cod_proveedor_norm,articulo_norm,proveedor_norm&order=idorden.asc`);
      await replaceProviderArticlesCache(rows, meta);
      return sortCatalogByDescription(rows.map(normalizeProviderArticle).filter((item) => item.descripcion || item.idart));
    }

    async function syncProviderArticleBlocks(meta) {
      const local = localProviderListMeta() || {};
      const lastSyncAt = local.last_provider_sync_at || local.updated_at || local.last_provider_sync_date || '';
      if (!lastSyncAt) return downloadProviderArticlesCloud(meta);
      const changedProviders = await fetchProvidersUpdatedAfter(lastSyncAt);
      if (!changedProviders.length) {
        setLocalProviderListMeta({ ...local, ...meta, last_provider_sync_at: new Date().toISOString(), last_provider_sync_date: today() });
        return null;
      }
      for (const provider of changedProviders) {
        const rows = await fetchProviderArticles(provider.id_proveedor);
        await replaceProviderArticlesCacheBlock(provider.id_proveedor, rows);
      }
      setLocalProviderListMeta({ ...local, ...meta, last_provider_sync_at: new Date().toISOString(), last_provider_sync_date: today() });
      return sortCatalogByDescription(await readProviderArticlesCache());
    }

    async function readProviderArticlesRemoteIfChanged() {
      try {
        const meta = await remoteProviderListMeta();
        if (!meta) return null;
        const local = localProviderListMeta();
        if (local && Number(local.lista_version) === Number(meta.lista_version)) return null;
        if (local && await providerCacheHasRows()) return syncProviderArticleBlocks(meta);
        return downloadProviderArticlesCloud(meta);
      } catch (error) {
        console.warn(error);
        return null;
      }
    }

    async function loadProviderNames() {
      let providers = await getProvidersCache();
      if (!providers.length) providers = await importProvidersCloud();
      return providers
        .map((provider) => ({ ...provider, idNorm: norm(provider.id_proveedor), nameNorm: norm(provider.proveedor) }))
        .sort((a, b) => String(a.proveedor || '').localeCompare(String(b.proveedor || ''), 'es', { numeric: true, sensitivity: 'base' }));
    }

    function catalogSource(useProviderList = false) {
      return useProviderList ? 'proveedores' : 'corralon';
    }

    function catalogSourceLabel(useProviderList = false) {
      return useProviderList ? 'listas de proveedores' : 'lista de corralon';
    }

    function resetCatalogToggle(checkbox) {
      if (checkbox) checkbox.checked = false;
    }

    function bindCatalogToggle(checkbox, onChange) {
      resetCatalogToggle(checkbox);
      if (!checkbox) return;
      checkbox.addEventListener('change', () => onChange(Boolean(checkbox.checked)));
    }

    function sortCatalogByDescription(rows = []) {
      return rows.sort((a, b) => String(a.descripcion || '').localeCompare(String(b.descripcion || ''), 'es', { numeric: true, sensitivity: 'base' }));
    }

    async function loadCorralonCatalog(cache = {}, force = false) {
      if (!cache.index || force) {
        const localRows = await readIndexCache();
        const needsRemote = force || !localRows.length || localRows.some((row) => row.idProveedor && !row.proveedor);
        const remoteRows = needsRemote ? await readIndexRemote() : [];
        cache.index = remoteRows.length ? remoteRows : localRows;
        if (!cache.index.length) cache.index = localRows;
        sortCatalogByDescription(cache.index);
      }
      return cache.index;
    }

    async function loadProviderCatalog(cache = {}, force = false) {
      if (!cache.proveedores || force) cache.proveedores = sortCatalogByDescription(await readProviderArticlesCache());
      return cache.proveedores;
    }

    async function loadProviderCatalogWithProgress(cache, onProgress) {
      if (typeof onProgress === 'function') onProgress(2);
      let rawItems = [];
      try {
        const database = await openListDb();
        rawItems = await new Promise((resolve, reject) => {
          const request = database.transaction('articulos').objectStore('articulos').getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.warn(error);
        if (!cache.proveedores) cache.proveedores = [];
        if (typeof onProgress === 'function') onProgress(100);
        return cache.proveedores;
      }
      if (!rawItems.length) {
        if (!cache.proveedores) cache.proveedores = [];
        if (typeof onProgress === 'function') onProgress(100);
        return cache.proveedores;
      }
      if (typeof onProgress === 'function') onProgress(8);
      const CHUNK = 5000;
      const result = [];
      for (let i = 0; i < rawItems.length; i += CHUNK) {
        const end = Math.min(i + CHUNK, rawItems.length);
        for (let j = i; j < end; j++) {
          const item = normalizeProviderArticle(rawItems[j]);
          if (item.descripcion || item.idart) result.push(item);
        }
        if (typeof onProgress === 'function') onProgress(8 + Math.round((end / rawItems.length) * 80));
        if (end < rawItems.length) await new Promise(r => setTimeout(r, 0));
      }
      cache.proveedores = result;
      if (typeof onProgress === 'function') onProgress(100);
      return result;
    }

    async function loadCatalog(useProviderList = false, cache = {}, force = false) {
      if (useProviderList) await loadProviderCatalog(cache, force);
      else await loadCorralonCatalog(cache, force);
      const catalog = useProviderList ? cache.proveedores : cache.index;
      const byIdart = new Map();
      for (const row of catalog) {
        const digits = String(row.idart || '').replace(/\D/g, '').padStart(6, '0');
        if (digits && !byIdart.has(digits)) byIdart.set(digits, row);
      }
      return { catalog, byIdart, cache };
    }

    async function syncCatalogInBackground(useProviderList = false, cache = {}, onUpdated = null) {
      try {
        const updated = useProviderList ? await readProviderArticlesRemoteIfChanged() : await readIndexRemoteIfChanged();
        if (!updated?.length) return false;
        if (useProviderList) cache.proveedores = sortCatalogByDescription(updated);
        else cache.index = sortCatalogByDescription(updated);
        if (typeof onUpdated === 'function') onUpdated(useProviderList ? cache.proveedores : cache.index, cache);
        return true;
      } catch (error) {
        console.warn(error);
        return false;
      }
    }

    function catalogFilter({ code = '', article = '', extra = '', columnFiltro = '', provider = '', providerId = '' } = {}) {
      return {
        code: searchNorm(code),
        articleWords: searchNorm(`${article} ${columnFiltro} ${extra}`).split(' ').filter(Boolean),
        provider: searchNorm(provider),
        providerId: cleanId(providerId)
      };
    }

    function catalogMatches(row, filter) {
      const providerIdMatch = !filter.providerId || idVariants(filter.providerId).some((id) => idVariants(row.idProveedor).includes(id));
      const providerTextMatch = filter.providerId || !filter.provider || row.proveedorNorm.includes(filter.provider);
      return (!filter.code || row.codProvNorm.includes(filter.code) || row.idartNorm.includes(filter.code)) &&
        providerIdMatch &&
        providerTextMatch &&
        (!filter.articleWords.length || filter.articleWords.every((word) => row.descripcionNorm.includes(word)));
    }

    function catalogOptions(catalog, filter, limit = 100) {
      const out = [];
      for (let i = 0; i < (catalog || []).length && out.length < limit; i++) {
        if (catalogMatches(catalog[i], filter)) out.push(catalog[i]);
      }
      return out;
    }

    function providerOptions(providers, text = '', limit = 100) {
      const query = norm(text);
      const out = [];
      for (let i = 0; i < providers.length && out.length < limit; i++) {
        const row = providers[i];
        if (!query || row.nameNorm.includes(query) || row.idNorm.includes(query)) out.push(row);
      }
      return out;
    }

    function applyArticle(row, item, columnFiltro = '') {
      if (!row || !item) return false;
      const precioCosto = Number(item.precioCosto || 0);
      Object.assign(row, {
        idart: item.idart,
        idProveedor: item.idProveedor || '',
        codProv: item.codProv,
        filtro: columnFiltro,
        proveedor: item.proveedor || '',
        descripcion: item.descripcion,
        precioCosto,
        precioFinal: item.source === 'index' ? precioCosto : Number(item.precioFinal || precioCosto),
        source: item.source
      });
      return true;
    }

    function applyIdart(row, byIdart, columnFiltro = '') {
      if (!row?.idart) return false;
      const padded = String(row.idart).replace(/\D/g, '').padStart(6, '0');
      row.idart = padded;
      return applyArticle(row, byIdart.get(padded), columnFiltro);
    }

    function sortRows(rows, sortState) {
      const sortValue = (row, col) => {
        if (col === 'id') return Number(row.id || Number.MAX_SAFE_INTEGER);
        if (col === 'cantidad' || col === 'precioCosto' || col === 'precioFinal') return Number(row[col] || 0);
        if (col === 'pedido') return row.pedido ? 1 : 0;
        return norm(row[col] || '');
      };
      const blank = rows.filter(isBlank);
      const filled = rows.filter((row) => !isBlank(row));
      filled.sort((a, b) => {
        const av = sortValue(a, sortState.col);
        const bv = sortValue(b, sortState.col);
        if (typeof av === 'number' || typeof bv === 'number') return ((Number(av) || 0) - (Number(bv) || 0)) * sortState.dir;
        return String(av).localeCompare(String(bv), 'es', { numeric: true, sensitivity: 'base' }) * sortState.dir;
      });
      return [...filled, ...blank.slice(-1)];
    }

    return {
      LOCAL_KEY,
      COLLECTION,
      searchNorm,
      makeLocalUid,
      blankRow,
      isBlank,
      loadLocalRows,
      saveLocalRows,
      loadColumnFiltro,
      loadRemoteRows,
      subscribeRows,
      saveRows,
      addRow,
      deleteRowsByUid,
      loadProviderNames,
      catalogSource,
      catalogSourceLabel,
      resetCatalogToggle,
      bindCatalogToggle,
      loadCorralonCatalog,
      loadProviderCatalog,
      loadProviderCatalogWithProgress,
      loadCatalog,
      syncCatalogInBackground,
      catalogFilter,
      catalogOptions,
      providerOptions,
      applyArticle,
      applyIdart,
      sortRows
    };
  })();

  window.CorralonSystem = {
    SUPABASE_URL,
    SUPABASE_KEY,
    TABLES,
    headers,
    norm,
    parseMoney,
    dateOnly,
    today,
    nowTimestamp,
    money,
    percent,
    providerFromObject,
    getProvidersCache,
    setProvidersCache,
    putProviderCacheItem,
    importProvidersCloud,
    uploadProviders,
    updateProviderDateOnly,
    touchPriceListMeta,
    replaceProviderArticles,
    buildArticlesXlsBlob,
    saveBlobAs,
    faltantes: FALTANTES
  };
})();
