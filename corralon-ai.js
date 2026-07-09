(function () {
  const SUPABASE_URL = 'https://tizyjenayrcdkcodsjnc.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpenlqZW5heXJjZGtjb2Rzam5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzE4MDYsImV4cCI6MjA4NzgwNzgwNn0.Xue8zgo8QJiKTErtzfUOgpczMngsAaePJZqLvA8Z7oI';
  const JSON_TABLE = 'listas_json_proveedores';
  const LOCAL_DB_HINTS = [
    'corralon_lista_proveedores_v1',
    'corralon_provider_catalog_v1',
    'corralon_catalog_cache_v1',
    'corralon_faltantes_v1',
    'corralon_pedidos_v1'
  ];
  const ARTICLE_STORES = ['articulos', 'articles', 'catalogo', 'catalog', 'productos'];
  const LOCAL_CACHE_MS = 3 * 60 * 1000;
  let localArticlesCache = { at: 0, rows: [] };
  let onlineManifestCache = { at: 0, rows: [] };

  function headers(extra = {}) {
    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...extra
    };
  }

  function norm(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9/%., -]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanId(value) {
    return String(value ?? '').trim().replace(/\.0+$/, '');
  }

  function words(value) {
    return norm(value).split(' ').filter((word) => word.length > 1);
  }

  function expandQuery(value) {
    let text = norm(value);
    text = text.replace(/\b(\d+)\s*(amp|amper|ampere|amperes)\b/g, '$1a $1 ampere');
    text = text.replace(/\b(\d+)\s*a\b/g, '$1a $1 ampere');
    text = text.replace(/\btermica\b/g, 'termica termicas');
    text = text.replace(/\btermicas\b/g, 'termicas termica');
    return text.replace(/\s+/g, ' ').trim();
  }

  function normalizeArticle(row = {}) {
    const descripcion = String(row.articulo || row.descripcion || row.nombre || row.detalle || '').trim();
    const codProv = String(row.cod_proveedor || row.codProv || row.codprov || row.codigo_proveedor || '').trim();
    const proveedor = String(row.proveedor || row.provider || '').trim();
    const idProveedor = cleanId(row.id_proveedor || row.idProveedor || row.idprov || '');
    return {
      ...row,
      idorden: row.idorden || row.id || row.localUid || `${idProveedor}-${codProv}-${descripcion}`,
      cod_proveedor: codProv,
      articulo: descripcion,
      descripcion,
      precio_costo: Number(row.precio_costo ?? row.precioCosto ?? row.precio ?? row.costo ?? 0) || 0,
      id_proveedor: idProveedor,
      proveedor,
      _ai_text: norm(`${codProv} ${descripcion} ${proveedor} ${idProveedor}`)
    };
  }

  function scoreArticle(article, queryWords, queryNorm) {
    if (!queryNorm) return 0;
    const text = article._ai_text || norm(`${article.cod_proveedor} ${article.articulo} ${article.proveedor}`);
    let score = 0;
    if (text === queryNorm) score += 1000;
    if (text.includes(queryNorm)) score += 260;
    if (norm(article.cod_proveedor) === queryNorm) score += 500;
    for (const word of queryWords) {
      if (text.includes(word)) score += 40;
      if (norm(article.articulo).startsWith(word)) score += 15;
    }
    const matched = queryWords.filter((word) => text.includes(word)).length;
    if (queryWords.length) score += (matched / queryWords.length) * 160;
    return score;
  }

  function openDb(name) {
    return new Promise((resolve) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }

  function readStore(db, storeName, limit) {
    return new Promise((resolve) => {
      if (!db || !db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const out = [];
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || out.length >= limit) {
          resolve(out);
          return;
        }
        out.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => resolve(out);
      tx.onerror = () => resolve(out);
    });
  }

  async function indexedDbNames() {
    if (indexedDB.databases) {
      try {
        const dbs = await indexedDB.databases();
        const names = dbs.map((db) => db.name).filter(Boolean);
        return [...new Set([...LOCAL_DB_HINTS, ...names])];
      } catch (_) {}
    }
    return LOCAL_DB_HINTS;
  }

  async function readIndexedDbArticles(limit = 250000) {
    const out = [];
    const names = await indexedDbNames();
    for (const name of names) {
      const db = await openDb(name);
      if (!db) continue;
      for (const store of ARTICLE_STORES) {
        if (!db.objectStoreNames.contains(store)) continue;
        const rows = await readStore(db, store, Math.max(0, limit - out.length));
        out.push(...rows);
        if (out.length >= limit) break;
      }
      db.close();
      if (out.length >= limit) break;
    }
    return out;
  }

  function readLocalStorageArticles(limit = 50000) {
    const out = [];
    for (let i = 0; i < localStorage.length && out.length < limit; i += 1) {
      const key = localStorage.key(i) || '';
      if (!/(articulo|article|catalog|producto|lista|proveedor)/i.test(key)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        const rows = Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : Array.isArray(value?.articulos) ? value.articulos : [];
        if (rows.length) out.push(...rows.slice(0, limit - out.length));
      } catch (_) {}
    }
    return out;
  }

  async function articulosLocales(options = {}) {
    const now = Date.now();
    if (!options.force && localArticlesCache.rows.length && now - localArticlesCache.at < LOCAL_CACHE_MS) return localArticlesCache.rows;
    const rows = [
      ...(await readIndexedDbArticles(options.limit || 250000)),
      ...readLocalStorageArticles(options.localStorageLimit || 50000)
    ].map(normalizeArticle).filter((row) => row.articulo || row.cod_proveedor);
    const byKey = new Map();
    for (const row of rows) {
      const key = String(row.idorden || `${row.id_proveedor}|${row.cod_proveedor}|${row.articulo}`);
      if (!byKey.has(key)) byKey.set(key, row);
    }
    localArticlesCache = { at: now, rows: [...byKey.values()] };
    return localArticlesCache.rows;
  }

  async function filasTablaJsonProveedores() {
    if (window.CorralonSystem?.fetchProviderJsonTableRows) {
      return CorralonSystem.fetchProviderJsonTableRows('order=proveedor.asc');
    }
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${JSON_TABLE}?select=id_proveedor,proveedor,json_url,chunks,chunk_count,total_articulos,version,fecha_actualizacion&order=proveedor.asc`, {
      headers: headers()
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  function urlsJsonProveedor(entry) {
    const chunks = Array.isArray(entry?.chunks) ? entry.chunks.map((chunk) => String(chunk?.json_url || '').trim()).filter(Boolean) : [];
    return chunks.length ? chunks : [String(entry?.json_url || '').trim()].filter(Boolean);
  }

  async function articulosOnline(options = {}) {
    const now = Date.now();
    if (!options.force && onlineManifestCache.rows.length && now - onlineManifestCache.at < LOCAL_CACHE_MS) return onlineManifestCache.rows;
    const providers = await filasTablaJsonProveedores();
    const out = [];
    const maxProviders = Number(options.maxProviders || 0) || providers.length;
    for (const provider of providers.slice(0, maxProviders)) {
      for (const url of urlsJsonProveedor(provider)) {
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}ai=${Date.now()}`);
        if (!response.ok) continue;
        const rows = await response.json();
        if (Array.isArray(rows)) out.push(...rows.map((row) => normalizeArticle({ ...row, proveedor: row.proveedor || provider.proveedor })));
        if (options.limit && out.length >= options.limit) break;
      }
      if (options.limit && out.length >= options.limit) break;
    }
    onlineManifestCache = { at: now, rows: out.slice(0, options.limit || out.length) };
    return onlineManifestCache.rows;
  }

  async function baseArticulos(options = {}) {
    const local = await articulosLocales(options);
    if (local.length || options.localOnly) return { source: 'local', rows: local };
    const online = await articulosOnline(options);
    return { source: 'online', rows: online };
  }

  async function buscarArticulos(query, options = {}) {
    const queryNorm = expandQuery(query);
    const queryWords = words(queryNorm);
    const base = await baseArticulos(options);
    const minScore = Number(options.minScore || 45);
    const limit = Number(options.limit || 50);
    const results = base.rows
      .map((row) => ({ ...row, _score: scoreArticle(row, queryWords, queryNorm) }))
      .filter((row) => row._score >= minScore)
      .sort((a, b) => b._score - a._score || String(a.articulo).localeCompare(String(b.articulo), 'es', { numeric: true }))
      .slice(0, limit);
    return { source: base.source, query: queryNorm, count: results.length, rows: results };
  }

  window.CorralonAI = {
    norm,
    words,
    expandQuery,
    normalizeArticle,
    articulosLocales,
    articulosOnline,
    baseArticulos,
    buscarArticulos,
    clearCache() {
      localArticlesCache = { at: 0, rows: [] };
      onlineManifestCache = { at: 0, rows: [] };
    }
  };
})();
