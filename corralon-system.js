(function () {
  const SUPABASE_URL = 'https://tizyjenayrcdkcodsjnc.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpenlqZW5heXJjZGtjb2Rzam5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzE4MDYsImV4cCI6MjA4NzgwNzgwNn0.Xue8zgo8QJiKTErtzfUOgpczMngsAaePJZqLvA8Z7oI';
  const TABLES = {
    providers: 'proveedores',
    providersMeta: 'proveedores_meta',
    priceList: 'lista_precios',
    priceListMeta: 'lista_precios_meta',
    priceListJsonProviders: 'listas_json_proveedores'
  };
  const PROVIDERS_DB = 'proveedores_cache_v1';
  const CLOUDINARY_RAW_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/do0i2da7h/raw/upload';
  const CLOUDINARY_UPLOAD_PRESET = 'Corralon';
  const PROVIDER_MANIFEST_PREFIX = 'provider_manifest:';
  const FULL_PROVIDER_MANIFEST_PREFIX = 'provider_full_manifest:';
  const CLOUDINARY_JSON_MAX_BYTES = 8 * 1024 * 1024;
  const IMAGE_GENERATOR_CATALOG_KEY = 'corralon_image_generator_catalog_v1';
  const IMAGE_GENERATOR_PAYLOAD_KEY = 'corralon_image_generator_payload_v1';
  const BRANCHES = [
    { id: 'progreso_ruta', label: 'Suc. Progreso y Ruta' },
    { id: 'calle5_espana', label: 'Suc. Calle 5 y Espana' }
  ];
  const BRANCH_STOCK_FIELDS = {
    progreso_ruta: ['stockSucursalProgresoRuta', 'stock_sucursal_progreso_ruta', 'stock_progreso_ruta', 'stockSucProgresoRuta', 'stockSuc1'],
    calle5_espana: ['stockSucursalCalle5Espana', 'stock_sucursal_calle5_espana', 'stock_calle5_espana', 'stockSucCalle5Espana', 'stockSuc2']
  };

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

  function parseFlexibleNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    let text = String(value).trim().replace(/[^0-9,.-]/g, '');
    if (!text) return null;
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      if (lastComma > lastDot) text = text.replace(/\./g, '').replace(/,/g, '.');
      else text = text.replace(/,/g, '');
    } else if (lastComma > -1) {
      text = text.replace(/\./g, '').replace(/,/g, '.');
    } else if ((text.match(/\./g) || []).length > 1) {
      text = text.replace(/\./g, '');
    }
    const number = Number(text);
    return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
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

  function normalizeBranch(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const branch = BRANCHES.find((item) => item.id === raw || item.label === raw);
    return branch ? branch.label : raw;
  }

  function branchIdFromIdsuc(value) {
    const id = cleanId(value);
    if (id === '1') return 'progreso_ruta';
    if (id === '2') return 'calle5_espana';
    return '';
  }

  function readFirstNumber(source = {}, keys = []) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source || {}, key)) continue;
      const parsed = parseFlexibleNumber(source[key]);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  function resolveBranchStocks(source = {}, old = {}) {
    let progreso = readFirstNumber(source, BRANCH_STOCK_FIELDS.progreso_ruta);
    let calle5 = readFirstNumber(source, BRANCH_STOCK_FIELDS.calle5_espana);
    const idsucBranch = branchIdFromIdsuc(source.idsuc ?? source.id_suc ?? source.idsucursal ?? source.id_sucursal ?? source.sucursal_id);
    const sourceStock = parseFlexibleNumber(source.stock ?? source.existencia ?? source.cantidad);

    if (idsucBranch === 'progreso_ruta' && sourceStock !== null) progreso = sourceStock;
    if (idsucBranch === 'calle5_espana' && sourceStock !== null) calle5 = sourceStock;

    if (progreso === null) progreso = readFirstNumber(old, BRANCH_STOCK_FIELDS.progreso_ruta);
    if (calle5 === null) calle5 = readFirstNumber(old, BRANCH_STOCK_FIELDS.calle5_espana);

    const fallback = sourceStock ?? parseFlexibleNumber(old.stock ?? old.existencia ?? old.cantidad);
    const hasBranch = progreso !== null || calle5 !== null;
    return {
      stockSucursalProgresoRuta: progreso === null ? '' : progreso,
      stockSucursalCalle5Espana: calle5 === null ? '' : calle5,
      stock: hasBranch ? Number(((progreso || 0) + (calle5 || 0)).toFixed(2)) : (fallback === null ? '' : fallback)
    };
  }

  function firstFilled(...values) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && !value.trim()) continue;
      return value;
    }
    return '';
  }

  function mergeArticleBranchStocks(rows = []) {
    const byCode = new Map();
    (rows || []).forEach((row) => {
      const codigo = cleanId(row?.codigo ?? row?.idart ?? row?.idArt ?? row?.id ?? '');
      if (!codigo) return;
      const current = byCode.get(codigo) || { ...row, codigo };
      Object.keys(row || {}).forEach((key) => {
        current[key] = firstFilled(current[key], row[key]);
      });
      const stockInfo = resolveBranchStocks(row, current);
      current.stockSucursalProgresoRuta = stockInfo.stockSucursalProgresoRuta;
      current.stockSucursalCalle5Espana = stockInfo.stockSucursalCalle5Espana;
      current.stock = stockInfo.stock;
      current.idsuc = '';
      byCode.set(codigo, current);
    });
    return [...byCode.values()].map((row) => ({ ...row, ...resolveBranchStocks(row) }));
  }

  function imageGeneratorText(value) {
    return String(value ?? '').trim();
  }

  function imageGeneratorNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function imageGeneratorNormalizeArticle(article = {}) {
    const codigo = imageGeneratorText(article.codigo ?? article.idart ?? article.idArt ?? article.id ?? article.codigoArticulo);
    const nombre = imageGeneratorText(article.nombre ?? article.descripcion ?? article.articulo ?? article.detalleArticulo ?? article.producto);
    return {
      codigo,
      nombre,
      detalle: imageGeneratorText(article.detalle ?? article.descripcionSecundaria ?? article.descripcion_larga),
      rubro: imageGeneratorText(article.rubro ?? article.categoria ?? article.familia),
      precio: imageGeneratorNumber(article.precioVigente ?? article.precioFinal ?? article.precio ?? article.precio_costo),
      stock: imageGeneratorNumber(article.stock ?? article.existencia ?? article.cantidad),
      fotoUrl: imageGeneratorText(article.fotoUrl ?? article.foto ?? article.imagen ?? article.imageUrl ?? article.urlImagen),
      oferta: Boolean(article.oferta ?? article.ofertaVigente ?? article.enOferta ?? article.tagOferta),
      ofertaPct: imageGeneratorNumber(article.ofertaPct ?? article.oferta_pct ?? article.ofertaPorcentaje ?? article.descuentoOferta),
      destacado: Boolean(article.destacado ?? article.tagDestacado),
      masVendido: Boolean(article.masVendido ?? article.mas_vendido ?? article.tagMasVendido),
      ceramico: Boolean(article.ceramico ?? article.tagCeramico),
      ceramicoM2: imageGeneratorNumber(article.ceramicoM2 ?? article.m2Ceramico ?? article.m2 ?? article.metros2Ceramico),
      tagsOcultos: Array.isArray(article.tagsOcultos)
        ? article.tagsOcultos.map(imageGeneratorText).filter(Boolean)
        : imageGeneratorText(article.tagsOcultos ?? article.tagsBusqueda ?? article.tags ?? article.palabrasClave)
    };
  }

  function imageGeneratorSplitTitle(nombre = '') {
    const words = imageGeneratorText(nombre).split(/\s+/).filter(Boolean);
    if (words.length <= 2) return { title1: words.join(' ').toUpperCase(), title2: '' };
    const breakAt = Math.min(3, Math.max(1, Math.ceil(words.length / 2)));
    return {
      title1: words.slice(0, breakAt).join(' ').toUpperCase(),
      title2: words.slice(breakAt).join(' ').toUpperCase()
    };
  }

  function imageGeneratorOfferPrice(article) {
    if (!article.oferta || article.ofertaPct <= 0) return article.precio;
    return Math.max(0, article.precio * (1 - article.ofertaPct / 100));
  }

  function imageGeneratorRow(icon, label, value, detail = '') {
    const cleanLabel = imageGeneratorText(label).toUpperCase();
    const cleanValue = imageGeneratorText(value).toUpperCase();
    const cleanDetail = imageGeneratorText(detail).toUpperCase();
    return cleanLabel || cleanValue || cleanDetail ? { icon, label: cleanLabel, value: cleanValue, detail: cleanDetail } : null;
  }

  function buildImageGeneratorPayload(article = {}) {
    const normalized = imageGeneratorNormalizeArticle(article);
    const title = imageGeneratorSplitTitle(normalized.nombre);
    const precioFinal = imageGeneratorOfferPrice(normalized);
    const precioRow = normalized.precio > 0
      ? imageGeneratorRow('check', normalized.oferta ? 'PRECIO OFERTA' : 'PRECIO', money(precioFinal), normalized.oferta && normalized.ofertaPct > 0 ? `${normalized.ofertaPct}% DTO` : '')
      : null;
    const stockRow = imageGeneratorRow('check', 'STOCK', normalized.stock ? `${normalized.stock}` : '', normalized.stock ? 'DISPONIBLES' : '');
    const rubroRow = imageGeneratorRow('gear', 'RUBRO', normalized.rubro, '');
    const specs = [
      imageGeneratorRow('check', 'CODIGO', normalized.codigo, ''),
      precioRow,
      normalized.oferta && normalized.precio > 0 ? imageGeneratorRow('check', 'PRECIO LISTA', money(normalized.precio), '') : null,
      stockRow,
      rubroRow,
      normalized.ceramicoM2 > 0 ? imageGeneratorRow('check', 'M2 POR CAJA', `${normalized.ceramicoM2}`, '') : null
    ].filter(Boolean).slice(0, 6);
    const highlights = [precioRow, stockRow, rubroRow].filter(Boolean).slice(0, 3);
    const benefits = [
      normalized.destacado ? { icon: 'check', label: 'DESTACADO', value: 'PRODUCTO DESTACADO' } : null,
      normalized.masVendido ? { icon: 'check', label: 'MAS VENDIDO', value: 'ALTA ROTACION' } : null,
      normalized.oferta ? { icon: 'bolt', label: 'EN OFERTA', value: normalized.ofertaPct > 0 ? `${normalized.ofertaPct}% DE DESCUENTO` : 'PRECIO ESPECIAL' } : null,
      normalized.ceramico ? { icon: 'check', label: 'CERAMICO', value: normalized.ceramicoM2 > 0 ? `${normalized.ceramicoM2} M2 POR CAJA` : 'POR CAJA' } : null
    ].filter(Boolean).slice(0, 4);

    return {
      article: normalized,
      fields: {
        brand: '',
        model: normalized.codigo,
        title1: title.title1 || normalized.nombre.toUpperCase(),
        title2: title.title2,
        description: normalized.detalle || normalized.rubro || '',
        badgeTitle: normalized.rubro ? 'RUBRO' : '',
        badgeValue: normalized.rubro || ''
      },
      rows: { highlights, specs, benefits },
      imageUrl: normalized.fotoUrl,
      createdAt: new Date().toISOString()
    };
  }

  function setImageGeneratorCatalog(articles = []) {
    const catalog = (articles || []).map(imageGeneratorNormalizeArticle).filter((article) => article.codigo || article.nombre);
    try {
      localStorage.setItem(IMAGE_GENERATOR_CATALOG_KEY, JSON.stringify({ savedAt: Date.now(), articles: catalog }));
    } catch (e) {}
    return catalog;
  }

  function getImageGeneratorCatalog() {
    try {
      const parsed = JSON.parse(localStorage.getItem(IMAGE_GENERATOR_CATALOG_KEY) || '{}');
      return Array.isArray(parsed.articles) ? parsed.articles : [];
    } catch (e) {
      return [];
    }
  }

  function setImageGeneratorPayload(articleOrPayload = {}) {
    const payload = articleOrPayload.fields ? articleOrPayload : buildImageGeneratorPayload(articleOrPayload);
    try {
      sessionStorage.setItem(IMAGE_GENERATOR_PAYLOAD_KEY, JSON.stringify(payload));
      localStorage.setItem(IMAGE_GENERATOR_PAYLOAD_KEY, JSON.stringify(payload));
    } catch (e) {}
    return payload;
  }

  function readImageGeneratorPayload(clearSession = false) {
    try {
      const raw = sessionStorage.getItem(IMAGE_GENERATOR_PAYLOAD_KEY) || localStorage.getItem(IMAGE_GENERATOR_PAYLOAD_KEY);
      if (clearSession) sessionStorage.removeItem(IMAGE_GENERATOR_PAYLOAD_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function openImageGenerator(articleOrPayload = {}, options = {}) {
    const payload = setImageGeneratorPayload(articleOrPayload);
    const code = payload?.article?.codigo || payload?.fields?.model || '';
    const url = `generador-imagen-producto.html${code ? `?articulo=${encodeURIComponent(code)}` : ''}`;
    if (options.open === false) return { payload, url };
    const target = options.target || '_blank';
    const features = options.features || 'width=1280,height=900,resizable=yes,scrollbars=yes';
    return window.open(url, target, features);
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
      pagina_link: String(getByHeader(obj, ['Pagina', 'Página', 'Link pagina', 'Link página', 'pagina_link', 'pagina', 'web', 'reserva_texto_1'])).trim(),
      nota: String(getByHeader(obj, ['Nota', 'nota'])).trim(),
      porc_flete: Number(getByHeader(obj, ['Porc.Flete', 'porc_flete'])) || 0,
      porc_iva: Number(getByHeader(obj, ['Porc.IVA', 'porc_iva'])) || 0,
      iva_incluido: Boolean(getByHeader(obj, ['Iva Incluido?', 'iva_incluido'])),
      descuento_total_fc: Number(getByHeader(obj, ['Descuento En Total FC', 'Descuento Final Factura', 'descuento_total_fc', 'descuento_final_factura'])) || null
    };
    provider.proveedor_norm = norm(provider.proveedor);
    return provider.id_proveedor && provider.proveedor ? provider : null;
  }

  const PROVIDER_REMOTE_COLUMNS = [
    'id_proveedor', 'proveedor', 'descuento_factura', 'descuento_lista', 'ultima_actualizacion',
    'vendedor', 'telefono', 'nota', 'porc_flete', 'porc_iva', 'iva_incluido',
    'descuento_total_fc', 'proveedor_norm', 'reserva_texto_1', 'reserva_texto_2',
    'reserva_texto_3', 'reserva_texto_4', 'reserva_numero_1', 'reserva_numero_2',
    'reserva_numero_3', 'reserva_fecha_1', 'reserva_fecha_2', 'reserva_json_1'
  ];

  function normalizeProviderPageLink(provider) {
    if (!provider) return provider;
    const link = String(provider.pagina_link || provider.pagina || provider.web || provider.reserva_texto_1 || '').trim();
    const descuentoTotalFc = provider.descuento_total_fc ?? provider.descuento_final_factura ?? null;
    const normalized = { ...provider, descuento_total_fc: descuentoTotalFc };
    return link ? { ...normalized, pagina_link: link, reserva_texto_1: link } : { ...normalized, pagina_link: '', reserva_texto_1: provider.reserva_texto_1 || null };
  }

  function providerRemotePayload(provider) {
    const normalized = normalizeProviderPageLink(provider) || {};
    const payload = {};
    for (const column of PROVIDER_REMOTE_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(normalized, column)) payload[column] = normalized[column];
    }
    payload.reserva_texto_1 = normalized.pagina_link || normalized.reserva_texto_1 || null;
    return payload;
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
    const providers = (await fetchAll(TABLES.providers, 'select=*&order=proveedor.asc')).map(normalizeProviderPageLink);
    if (providers.length) await setProvidersCache(providers);
    return providers;
  }

  async function uploadProviders(data, fileName = '') {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providers}?id_proveedor=not.is.null`, { method: 'DELETE', headers: headers() });
    for (let i = 0; i < data.length; i += 1000) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providers}?on_conflict=id_proveedor`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(data.slice(i, i + 1000).map(providerRemotePayload))
      });
      if (!response.ok) throw new Error(await response.text());
    }
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providersMeta}?on_conflict=id`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ id: 'principal', version: Date.now(), total_proveedores: data.length, archivo_nombre: fileName })
    });
    await setProvidersCache(data.map(normalizeProviderPageLink));
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

  function priceListMetaPayload(extra = {}) {
    const payload = { id: 'principal', lista_version: Date.now(), ...extra };
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) delete payload[key];
    });
    return payload;
  }

  async function touchPriceListMeta(extra = {}) {
    const payload = priceListMetaPayload(extra);
    let response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?on_conflict=id`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(payload)
    });
    if (!response.ok && payload.reserva_json_1) {
      const text = await response.clone().text();
      if (text.includes('reserva_json_1')) {
        const fallback = { ...payload };
        fallback.importado_por = fallback.importado_por || fallback.reserva_json_1;
        delete fallback.reserva_json_1;
        response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?on_conflict=id`, {
          method: 'POST',
          headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(fallback)
        });
      }
    }
    if (!response.ok) throw new Error(await response.text());
    return payload;
  }

  function manifestUrlFromMetaValue(value) {
    const text = String(value || '').trim();
    return text.startsWith(PROVIDER_MANIFEST_PREFIX) ? text.slice(PROVIDER_MANIFEST_PREFIX.length) : '';
  }
  function fullManifestUrlFromMetaValue(value) {
    const text = String(value || '').trim();
    return text.startsWith(FULL_PROVIDER_MANIFEST_PREFIX) ? text.slice(FULL_PROVIDER_MANIFEST_PREFIX.length) : '';
  }

  async function remotePriceListMeta() {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?id=eq.principal&select=lista_version,total_articulos,archivo_nombre,importado_por,updated_at&limit=1`, {
      headers: headers()
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json())?.[0] || null;
  }

  function jsonByteLength(text) {
    return new TextEncoder().encode(String(text || '')).length;
  }

  function splitJsonRows(rows = [], maxBytes = CLOUDINARY_JSON_MAX_BYTES) {
    const chunks = [];
    let current = [];
    let currentBytes = 2;
    for (const row of rows) {
      const rowText = JSON.stringify(row);
      const rowBytes = jsonByteLength(rowText);
      const separatorBytes = current.length ? 1 : 0;
      if (current.length && currentBytes + separatorBytes + rowBytes > maxBytes) {
        chunks.push(current);
        current = [];
        currentBytes = 2;
      }
      current.push(row);
      currentBytes += (current.length > 1 ? 1 : 0) + rowBytes;
    }
    if (current.length || !chunks.length) chunks.push(current);
    return chunks;
  }

  async function uploadRawJsonTextToCloudinary(jsonText, publicId) {
    const formData = new FormData();
    formData.append('file', new Blob([jsonText], { type: 'application/json' }), `${publicId}.json`);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('public_id', publicId);
    formData.append('resource_type', 'raw');
    const response = await fetch(CLOUDINARY_RAW_UPLOAD_URL, { method: 'POST', body: formData });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!response.ok) throw new Error(data?.error?.message || text || 'Error subiendo JSON');
    if (!data?.secure_url) throw new Error('Cloudinary no devolvio URL del JSON');
    return data.secure_url;
  }

  async function uploadRawJsonToCloudinary(payload, publicId) {
    return uploadRawJsonTextToCloudinary(JSON.stringify(payload), publicId);
  }

  async function uploadProviderRowsJsonChunks(rows, basePublicId) {
    const chunks = splitJsonRows(rows);
    const uploaded = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const suffix = chunks.length > 1 ? `_parte_${index + 1}` : '';
      const jsonUrl = await uploadRawJsonToCloudinary(chunks[index], `${basePublicId}${suffix}`);
      uploaded.push({
        index: index + 1,
        total: chunks.length,
        rows: chunks[index].length,
        json_url: jsonUrl
      });
    }
    return uploaded;
  }

  function providerJsonTableEntryFromManifestEntry(entry) {
    return {
      id_proveedor: cleanId(entry?.id_proveedor),
      proveedor: String(entry?.proveedor || '').trim(),
      json_url: String(entry?.json_url || '').trim(),
      chunks: Array.isArray(entry?.chunks) ? entry.chunks : [],
      chunk_count: Number(entry?.chunk_count || entry?.chunks?.length || 1) || 1,
      total_articulos: Number(entry?.total_articulos || 0) || 0,
      version: Number(entry?.version || 0) || 0,
      fecha_actualizacion: entry?.updated_at || new Date().toISOString(),
      manifest_updated_at: new Date().toISOString()
    };
  }

  function providerJsonManifestFromTableRows(rows = []) {
    const providers = {};
    for (const row of rows || []) {
      const id = cleanId(row?.id_proveedor);
      if (!id) continue;
      const chunks = Array.isArray(row?.chunks) ? row.chunks : [];
      providers[id] = {
        id_proveedor: id,
        proveedor: row?.proveedor || '',
        version: Number(row?.version || 0),
        updated_at: row?.fecha_actualizacion || row?.updated_at || '',
        total_articulos: Number(row?.total_articulos || 0),
        json_url: row?.json_url || chunks[0]?.json_url || '',
        chunk_count: Number(row?.chunk_count || chunks.length || 1),
        chunks
      };
    }
    return {
      id: 'provider-json-table-v1',
      version: Object.values(providers).reduce((max, entry) => Math.max(max, Number(entry.version || 0)), 0),
      updated_at: new Date().toISOString(),
      total_articulos: Object.values(providers).reduce((sum, entry) => sum + (Number(entry.total_articulos || 0) || 0), 0),
      providers
    };
  }

  async function upsertProviderJsonTableEntry(entry) {
    const payload = providerJsonTableEntryFromManifestEntry(entry);
    if (!payload.id_proveedor) return null;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListJsonProviders}?on_conflict=id_proveedor`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json())?.[0] || payload;
  }

  async function fetchProviderJsonTableRows(query = '') {
    const select = 'select=id_proveedor,proveedor,json_url,chunks,chunk_count,total_articulos,version,fecha_actualizacion,updated_at';
    const suffix = query ? `&${query}` : '&order=proveedor.asc';
    return fetchAll(TABLES.priceListJsonProviders, `${select}${suffix}`);
  }

  async function fetchProviderJsonTableManifest() {
    const rows = await fetchProviderJsonTableRows();
    return providerJsonManifestFromTableRows(rows);
  }

  async function loadProviderJsonManifest() {
    const meta = await remotePriceListMeta().catch(() => null);
    const manifestUrl = manifestUrlFromMetaValue(meta?.archivo_nombre);
    if (!manifestUrl) {
      return {
        meta,
        manifest: { id: 'provider-json-manifest-v1', version: 0, updated_at: '', providers: {} },
        manifestUrl: ''
      };
    }
    const response = await fetch(`${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
    if (!response.ok) throw new Error(await response.text());
    const manifest = await response.json();
    return {
      meta,
      manifest: {
        id: 'provider-json-manifest-v1',
        version: Number(manifest?.version || 0),
        updated_at: manifest?.updated_at || '',
        providers: manifest?.providers && typeof manifest.providers === 'object' ? manifest.providers : {}
      },
      manifestUrl
    };
  }
  async function loadFullProviderJsonManifest(meta) {
    const manifestUrl = fullManifestUrlFromMetaValue(meta?.reserva_json_1 || meta?.importado_por);
    if (!manifestUrl) return null;
    const response = await fetch(`${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
    if (!response.ok) return null;
    const manifest = await response.json();
    return {
      id: 'provider-json-manifest-v1',
      version: Number(manifest?.version || 0),
      updated_at: manifest?.updated_at || '',
      total_articulos: Number(manifest?.total_articulos || 0),
      providers: manifest?.providers && typeof manifest.providers === 'object' ? manifest.providers : {}
    };
  }

  function providerArticleJsonRows(providerId, articles = []) {
    const id = cleanId(providerId);
    const baseOrder = Date.now() * 1000;
    return (articles || []).map((article, index) => ({
      idorden: Number(article.idorden || 0) || baseOrder + index,
      cod_proveedor: String(article.cod_proveedor || article.codProv || '').trim(),
      articulo: String(article.articulo || article.descripcion || '').trim(),
      precio_costo: Number(article.precio_costo ?? article.precioCosto ?? 0) || 0,
      id_proveedor: cleanId(article.id_proveedor || article.idProveedor || id),
      proveedor: String(article.proveedor || '').trim(),
      cod_proveedor_norm: norm(article.cod_proveedor_norm || article.cod_proveedor || article.codProv || ''),
      articulo_norm: norm(article.articulo_norm || article.articulo || article.descripcion || ''),
      proveedor_norm: norm(article.proveedor_norm || article.proveedor || ''),
      articulo_source: article.articulo_source || 'actualizar_articulos_json'
    }));
  }

  function providerJsonUrlsFromEntry(entry) {
    const chunks = Array.isArray(entry?.chunks) ? entry.chunks.map((chunk) => String(chunk?.json_url || '').trim()).filter(Boolean) : [];
    return chunks.length ? chunks : [String(entry?.json_url || '').trim()].filter(Boolean);
  }

  async function fetchProviderJsonRowsForEntry(entry) {
    const urls = providerJsonUrlsFromEntry(entry);
    const out = [];
    for (const url of urls) {
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(entry?.version || '')}`);
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      if (Array.isArray(rows)) out.push(...rows);
    }
    return out;
  }

  function providerJsonMergeKey(row) {
    const byCode = norm(row?.cod_proveedor || row?.codProv || row?.codprov || '');
    if (byCode) return `cod:${byCode}`;
    const byArticle = norm(row?.articulo || row?.descripcion || row?.nombre || '');
    return byArticle ? `art:${byArticle}` : '';
  }

  function mergeProviderJsonRows(existingRows, incomingRows) {
    const map = new Map();
    const order = [];
    (existingRows || []).forEach((row) => {
      const normalized = providerArticleJsonRows(row?.id_proveedor, [row])[0];
      const key = providerJsonMergeKey(normalized);
      if (!key) return;
      if (!map.has(key)) order.push(key);
      map.set(key, normalized);
    });
    (incomingRows || []).forEach((row) => {
      const key = providerJsonMergeKey(row);
      if (!key) return;
      const previous = map.get(key);
      if (!previous) order.push(key);
      map.set(key, {
        ...row,
        idorden: Number(previous?.idorden || row.idorden || 0) || Date.now() * 1000 + order.length
      });
    });
    return order.map((key) => map.get(key)).filter(Boolean);
  }

  async function publishProviderArticlesJson(providerId, articles = [], options = {}) {
    const id = cleanId(providerId);
    if (!id) throw new Error('Proveedor sin ID para publicar JSON');
    let rows = providerArticleJsonRows(id, articles);
    const version = Date.now();
    const loaded = await loadProviderJsonManifest();
    if (options?.mergeExisting) {
      const tableManifest = await fetchProviderJsonTableManifest().catch(() => null);
      const existingEntry = tableManifest?.providers?.[id] || loaded.manifest?.providers?.[id] || null;
      if (existingEntry) {
        const existingRows = await fetchProviderJsonRowsForEntry(existingEntry).catch((error) => {
          console.warn(error);
          return [];
        });
        rows = mergeProviderJsonRows(existingRows, rows);
      }
    }
    const providerName = String(rows.find((row) => row.proveedor)?.proveedor || articles.find((row) => row?.proveedor)?.proveedor || '').trim();
    const chunks = await uploadProviderRowsJsonChunks(rows, `listas_proveedores/proveedor_${id}_${version}`);
    const jsonUrl = chunks[0]?.json_url || '';
    const manifest = loaded.manifest || { id: 'provider-json-manifest-v1', providers: {} };
    const providers = { ...(manifest.providers || {}) };
    providers[id] = {
      id_proveedor: id,
      proveedor: providerName,
      version,
      updated_at: new Date().toISOString(),
      total_articulos: rows.length,
      json_url: jsonUrl,
      chunk_count: chunks.length,
      chunks
    };
    const nextManifest = {
      id: 'provider-json-manifest-v1',
      version,
      updated_at: new Date().toISOString(),
      providers
    };
    const manifestUrl = await uploadRawJsonToCloudinary(nextManifest, `listas_proveedores/manifest_${version}`);
    let fullManifestUrl = '';
    const fullManifest = await loadFullProviderJsonManifest(loaded.meta).catch(() => null);
    const fullProviders = { ...(fullManifest?.providers || providers) };
    fullProviders[id] = providers[id];
    const nextFullManifest = {
      id: 'provider-json-manifest-v1',
      version,
      updated_at: new Date().toISOString(),
      total_articulos: Object.values(fullProviders).reduce((sum, entry) => sum + (Number(entry?.total_articulos || 0) || 0), 0),
      providers: fullProviders
    };
    fullManifestUrl = await uploadRawJsonToCloudinary(nextFullManifest, `listas_proveedores/manifest_completo_${version}`);
    await upsertProviderJsonTableEntry(providers[id]);
    return { manifest: nextManifest, manifestUrl, fullManifestUrl, entry: providers[id] };
  }

  async function replaceProviderArticlesSupabase(providerId, articles, onProgress = null) {
    const del = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceList}?id_proveedor=eq.${encodeURIComponent(providerId)}`, { method: 'DELETE', headers: headers() });
    if (!del.ok) throw new Error(await del.text());
    if (typeof onProgress === 'function') onProgress(0, articles.length);
    for (let i = 0; i < articles.length; i += 1000) {
      const chunk = articles.slice(i, i + 1000).map((article, n) => ({
        ...article,
        idorden: Number(article.idorden || 0) || Date.now() * 1000 + i + n,
        articulo_source: article.articulo_source || 'actualizar_articulos'
      }));
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceList}?on_conflict=idorden`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(chunk)
      });
      if (!response.ok) throw new Error(await response.text());
      if (typeof onProgress === 'function') onProgress(Math.min(i + 1000, articles.length), articles.length);
    }
  }

  async function replaceProviderArticles(providerId, articles, onProgress = null, options = {}) {
    const id = cleanId(providerId);
    const rows = providerArticleJsonRows(id, articles).map((row) => ({ ...row, articulo_source: 'actualizar_articulos' }));
    if (typeof onProgress === 'function') onProgress(0, rows.length);
    try {
      const published = await publishProviderArticlesJson(id, rows, options);
      if (typeof onProgress === 'function') onProgress(rows.length, rows.length);
      await touchPriceListMeta({
        lista_version: published.manifest.version,
        archivo_nombre: `${PROVIDER_MANIFEST_PREFIX}${published.manifestUrl}`,
        importado_por: published.fullManifestUrl ? `${FULL_PROVIDER_MANIFEST_PREFIX}${published.fullManifestUrl}` : undefined
      });
      return published;
    } catch (error) {
      console.warn(error);
      if (options?.mergeExisting) throw error;
      await replaceProviderArticlesSupabase(id, rows, onProgress);
      await touchPriceListMeta();
      return null;
    }
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
        sucursalId: '',
        sucursal: '',
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
      const firstText = (...values) => {
        for (const value of values) {
          const text = String(value ?? '').trim();
          if (text) return text;
        }
        return '';
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
      const idProveedor = cleanId(firstText(
        item.id_proveedor,
        item.idProveedor,
        item.IDProveedor,
        item.IDPROVEEDOR,
        item['ID Proveedor'],
        item['Id Proveedor'],
        item['id proveedor'],
        item.idproveedor,
        item.idProveed,
        item.IDProveed,
        item.idproveed,
        item.idprov,
        item.id_cliente,
        item.idCliente,
        item.IDCliente
      ));
      const proveedor = firstText(
        item.proveedor,
        item.Proveedor,
        item.nombreProveedor,
        item.NombreProveedor,
        item.proveedor_nombre,
        item.nombre_proveedor,
        item.proveedorDescripcion,
        item.proveedor_descripcion,
        item.Proveedores_Descripcion,
        item.proveedores_descripcion,
        item.razonSocial,
        item.razon_social,
        item.RazonSocial,
        item.razonsocial,
        item.cliente,
        item.Cliente
      );
      return withSearch({
        source: 'index',
        idart,
        idProveedor,
        codProv,
        filtro: String(item.filtro || ''),
        proveedor,
        descripcion,
        precioCosto,
        precioFinal
      });
    }

    function normalizeProviderArticle(item) {
      return withSearch({
        source: 'proveedores',
        idart: String(item.idart || item.idorden || '').padStart(6, '0'),
        idProveedor: cleanId(item.id_proveedor || item.idProveedor || ''),
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
        sucursalId: item.sucursal_id || item.sucursalId || '',
        sucursal: item.sucursal || normalizeBranch(item.sucursal_id || item.sucursalId || ''),
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
        sucursal_id: row.sucursalId || '',
        sucursal: normalizeBranch(row.sucursal || row.sucursalId || ''),
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
      }, 4);
    }

    async function readProviderArticlesCache() {
      try {
        const database = await openListDb();
        return await new Promise((resolve, reject) => {
          const out = [];
          const request = database.transaction('articulos').objectStore('articulos').openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve(out);
              return;
            }
            const item = normalizeProviderArticle(cursor.value);
            if (item.descripcion || item.idart) out.push(item);
            cursor.continue();
          };
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.warn(error);
        return [];
      }
    }

    async function readProviderArticlesCacheByProvider(providerId = '', providerName = '') {
      try {
        const database = await openListDb();
        const id = cleanId(providerId);
        const name = String(providerName || '').trim();
        const rawItems = await new Promise((resolve, reject) => {
          const tx = database.transaction('articulos', 'readonly');
          const store = tx.objectStore('articulos');
          if (id && store.indexNames.contains('id_proveedor')) {
            const request = store.index('id_proveedor').getAll(id);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
            return;
          }
          if (name && store.indexNames.contains('proveedor')) {
            const request = store.index('proveedor').getAll(name);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
            return;
          }
          resolve([]);
        });
        return sortCatalogByDescription(rawItems.map(normalizeProviderArticle).filter((item) => item.descripcion || item.idart));
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
        const id = String(providerId || '');
        const tx = database.transaction('articulos', 'readwrite');
        const store = tx.objectStore('articulos');
        const source = store.indexNames.contains('id_proveedor')
          ? store.index('id_proveedor')
          : store;
        const request = source.openCursor(store.indexNames.contains('id_proveedor') ? IDBKeyRange.only(id) : null);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (source !== store || String(cursor.value?.id_proveedor || '') === id) cursor.delete();
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

    async function fetchProviderJsonManifest(meta) {
      const tableManifest = await fetchProviderJsonTableManifest().catch((error) => {
        console.warn(error);
        return null;
      });
      if (tableManifest && Object.keys(tableManifest.providers || {}).length) return tableManifest;
      const url = manifestUrlFromMetaValue(meta?.archivo_nombre);
      if (!url) return null;
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
      if (!response.ok) throw new Error(await response.text());
      const manifest = await response.json();
      return {
        id: 'provider-json-manifest-v1',
        version: Number(manifest?.version || 0),
        updated_at: manifest?.updated_at || '',
        providers: manifest?.providers && typeof manifest.providers === 'object' ? manifest.providers : {}
      };
    }

    function localProviderJsonManifest(meta) {
      return meta?.provider_json_manifest && typeof meta.provider_json_manifest === 'object'
        ? meta.provider_json_manifest
        : {};
    }

    function providerJsonManifestEntries(manifest) {
      return Object.values(manifest?.providers || {}).filter((entry) => entry?.id_proveedor && providerJsonUrls(entry).length);
    }
    function findProviderJsonEntry(manifest, provider = '', providerId = '') {
      const id = cleanId(providerId || String(provider || '').match(/^\s*([0-9.]+)\s*[-–]/)?.[1] || '');
      const name = norm(String(provider || '').replace(/^\s*\d+\s*[-–]\s*/, ''));
      const entries = providerJsonManifestEntries(manifest);
      if (id) {
        const byId = entries.find((entry) => cleanId(entry.id_proveedor) === id);
        if (byId) return byId;
      }
      if (name) {
        return entries.find((entry) => norm(entry.proveedor) === name) || entries.find((entry) => norm(entry.proveedor).includes(name) || name.includes(norm(entry.proveedor)));
      }
      return null;
    }

    function providerJsonUrls(entry) {
      const chunks = Array.isArray(entry?.chunks) ? entry.chunks.map((chunk) => String(chunk?.json_url || '').trim()).filter(Boolean) : [];
      return chunks.length ? chunks : [String(entry?.json_url || '').trim()].filter(Boolean);
    }

    function needsProviderJsonSync(entry, localManifest) {
      const id = cleanId(entry.id_proveedor);
      const local = localManifest[id];
      if (!local) return true;
      if (providerJsonUrls(local).join('|') !== providerJsonUrls(entry).join('|')) return true;
      return Number(local.version || 0) < Number(entry.version || 0);
    }

    function normalizeProviderJsonCacheRow(row, entry, index) {
      const id = cleanId(row?.id_proveedor || row?.idProveedor || entry?.id_proveedor || '');
      const providerName = String(row?.proveedor || entry?.proveedor || '').trim();
      const cod = String(row?.cod_proveedor || row?.codProv || row?.codprov || '').trim();
      const article = String(row?.articulo || row?.descripcion || row?.nombre || '').trim();
      return {
        idorden: Number(row?.idorden || 0) || Number(entry?.version || Date.now()) * 1000 + index,
        cod_proveedor: cod,
        articulo: article,
        precio_costo: Number(row?.precio_costo ?? row?.precioCosto ?? row?.precio ?? 0) || 0,
        id_proveedor: id,
        proveedor: providerName,
        cod_proveedor_norm: norm(row?.cod_proveedor_norm || cod),
        articulo_norm: norm(row?.articulo_norm || article),
        proveedor_norm: norm(row?.proveedor_norm || providerName),
        articulo_source: row?.articulo_source || 'provider_json'
      };
    }

    async function fetchProviderJsonRows(entry) {
      const urls = providerJsonUrls(entry);
      const out = [];
      for (const url of urls) {
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(entry.version || '')}`);
        if (!response.ok) throw new Error(await response.text());
        const rows = await response.json();
        if (Array.isArray(rows)) {
          const offset = out.length;
          out.push(...rows.map((row, index) => normalizeProviderJsonCacheRow(row, entry, offset + index)).filter((row) => row.articulo || row.cod_proveedor));
        }
      }
      return out;
    }

    async function downloadProviderArticlesCloud(meta) {
      const rows = await fetchAll(TABLES.priceList, `select=idorden,cod_proveedor,articulo,precio_costo,id_proveedor,proveedor,cod_proveedor_norm,articulo_norm,proveedor_norm&order=idorden.asc`);
      await replaceProviderArticlesCache(rows, meta);
      return sortCatalogByDescription(rows.map(normalizeProviderArticle).filter((item) => item.descripcion || item.idart));
    }

    async function syncProviderJsonBlocks(meta, options = {}) {
      const manifest = await fetchProviderJsonManifest(meta).catch((error) => {
        console.warn(error);
        return null;
      });
      if (!manifest) return null;
      const local = localProviderListMeta() || {};
      const localManifest = localProviderJsonManifest(local);
      const entries = providerJsonManifestEntries(manifest);
      const changed = options.forceAll ? entries : entries.filter((entry) => needsProviderJsonSync(entry, localManifest));
      if (!changed.length) {
        if (options.updateWhenNoChanges !== false) {
          setLocalProviderListMeta({
            ...local,
            ...meta,
            provider_json_manifest: manifest.providers,
            last_provider_sync_at: new Date().toISOString(),
            last_provider_sync_date: today()
          });
        }
        return false;
      }
      const nextLocalManifest = options.forceAll ? {} : { ...localManifest };
      if (options.clearBeforeImport) {
        const database = await openListDb();
        await new Promise((resolve, reject) => {
          const request = database.transaction('articulos', 'readwrite').objectStore('articulos').clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
      for (const entry of changed) {
        const deletePromise = options.clearBeforeImport ? Promise.resolve() : replaceProviderArticlesCacheBlock(entry.id_proveedor, []);
        const rows = await fetchProviderJsonRows(entry);
        await deletePromise;
        await replaceProviderArticlesCacheBlock(entry.id_proveedor, rows);
        nextLocalManifest[cleanId(entry.id_proveedor)] = {
          id_proveedor: cleanId(entry.id_proveedor),
          proveedor: entry.proveedor || '',
          version: Number(entry.version || 0),
          updated_at: entry.updated_at || '',
          total_articulos: Number(entry.total_articulos || rows.length),
          json_url: entry.json_url,
          chunk_count: Number(entry.chunk_count || providerJsonUrls(entry).length || 1),
          chunks: Array.isArray(entry.chunks) ? entry.chunks : null
        };
      }
      setLocalProviderListMeta({
        ...local,
        ...meta,
        provider_json_manifest: nextLocalManifest,
        last_provider_sync_at: new Date().toISOString(),
        last_provider_sync_date: today()
      });
      return sortCatalogByDescription(await readProviderArticlesCache());
    }

    async function syncSingleProviderJson(provider = '', providerId = '') {
      const meta = await remoteProviderListMeta();
      if (!meta) return [];
      const manifest = await fetchProviderJsonManifest(meta);
      if (!manifest) return [];
      const entry = findProviderJsonEntry(manifest, provider, providerId);
      if (!entry) return [];
      const local = localProviderListMeta() || {};
      const localManifest = localProviderJsonManifest(local);
      if (!needsProviderJsonSync(entry, localManifest)) {
        const cached = await readProviderArticlesCacheByProvider(entry.id_proveedor, entry.proveedor);
        if (cached.length) return cached;
      }
      const rows = await fetchProviderJsonRows(entry);
      await replaceProviderArticlesCacheBlock(entry.id_proveedor, rows);
      setLocalProviderListMeta({
        ...local,
        ...meta,
        provider_json_manifest: {
          ...localManifest,
          [cleanId(entry.id_proveedor)]: {
            id_proveedor: cleanId(entry.id_proveedor),
            proveedor: entry.proveedor || '',
            version: Number(entry.version || 0),
            updated_at: entry.updated_at || '',
            total_articulos: Number(entry.total_articulos || rows.length),
            json_url: entry.json_url,
            chunk_count: Number(entry.chunk_count || providerJsonUrls(entry).length || 1),
            chunks: Array.isArray(entry.chunks) ? entry.chunks : null
          }
        },
        last_provider_sync_at: new Date().toISOString(),
        last_provider_sync_date: today()
      });
      return rows.map(normalizeProviderArticle).filter((item) => item.descripcion || item.idart);
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
        const hasCachedRows = await providerCacheHasRows();
        const metaVersionMatches = local && Number(local.lista_version) === Number(meta.lista_version);
        if (metaVersionMatches && hasCachedRows) return null;
        if (local && hasCachedRows) {
          const jsonResult = await syncProviderJsonBlocks(meta, { updateWhenNoChanges: Boolean(metaVersionMatches) });
          if (jsonResult) return jsonResult;
          if (jsonResult === false && manifestUrlFromMetaValue(meta.archivo_nombre)) return null;
          if (jsonResult === false && metaVersionMatches) return null;
          return syncProviderArticleBlocks(meta);
        }
        if (manifestUrlFromMetaValue(meta.archivo_nombre)) return null;
        const jsonResult = await syncProviderJsonBlocks(meta);
        if (jsonResult) return jsonResult;
        return downloadProviderArticlesCloud(meta);
      } catch (error) {
        console.warn(error);
        return null;
      }
    }

    async function loadProviderNames() {
      let providers = [];
      try {
        providers = await importProvidersCloud();
      } catch (error) {
        console.warn(error);
        providers = await getProvidersCache();
      }
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
      const result = [];
      try {
        const database = await openListDb();
        const total = await new Promise((resolve, reject) => {
          const request = database.transaction('articulos').objectStore('articulos').count();
          request.onsuccess = () => resolve(Number(request.result || 0));
          request.onerror = () => reject(request.error);
        });
        if (!total) {
          cache.proveedores = cache.proveedores || [];
          if (typeof onProgress === 'function') onProgress(100);
          return cache.proveedores;
        }
        if (typeof onProgress === 'function') onProgress(8);
        await new Promise((resolve, reject) => {
          const store = database.transaction('articulos', 'readonly').objectStore('articulos');
          const request = store.openCursor();
          let read = 0;
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve();
              return;
            }
            const item = normalizeProviderArticle(cursor.value);
            if (item.descripcion || item.idart) result.push(item);
            read++;
            if (read % 1500 === 0) {
              if (typeof onProgress === 'function') onProgress(8 + Math.round((read / total) * 88));
            }
            cursor.continue();
          };
        });
      } catch (error) {
        console.warn(error);
        if (!cache.proveedores) cache.proveedores = [];
        if (typeof onProgress === 'function') onProgress(100);
        return cache.proveedores;
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
      const exactCodeMatch = filter.code && (row.codProvNorm === filter.code || row.idartNorm === filter.code);
      if (exactCodeMatch) return providerIdMatch && providerTextMatch;
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
      syncSingleProviderJson,
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
    BRANCHES,
    PROVIDER_MANIFEST_PREFIX,
    headers,
    norm,
    parseMoney,
    parseFlexibleNumber,
    dateOnly,
    today,
    nowTimestamp,
    money,
    percent,
    normalizeBranch,
    branchIdFromIdsuc,
    resolveBranchStocks,
    mergeArticleBranchStocks,
    providerFromObject,
    normalizeProviderPageLink,
    providerRemotePayload,
    getProvidersCache,
    setProvidersCache,
    putProviderCacheItem,
    importProvidersCloud,
    uploadProviders,
    updateProviderDateOnly,
    touchPriceListMeta,
    loadProviderJsonManifest,
    fetchProviderJsonTableRows,
    fetchProviderJsonTableManifest,
    upsertProviderJsonTableEntry,
    publishProviderArticlesJson,
    replaceProviderArticles,
    buildArticlesXlsBlob,
    saveBlobAs,
    buildImageGeneratorPayload,
    setImageGeneratorCatalog,
    getImageGeneratorCatalog,
    setImageGeneratorPayload,
    readImageGeneratorPayload,
    openImageGenerator,
    faltantes: FALTANTES
  };
})();
