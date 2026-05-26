const SUPABASE_URL = 'https://tizyjenayrcdkcodsjnc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpenlqZW5heXJjZGtjb2Rzam5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzE4MDYsImV4cCI6MjA4NzgwNzgwNn0.Xue8zgo8QJiKTErtzfUOgpczMngsAaePJZqLvA8Z7oI';
const PRICE_TABLE = 'lista_precios';
const PROVIDERS_TABLE = 'proveedores';
const META_TABLE = 'lista_precios_meta';
const CLOUDINARY_RAW_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/do0i2da7h/raw/upload';
const CLOUDINARY_UPLOAD_PRESET = 'Corralon';
const PROVIDER_MANIFEST_PREFIX = 'provider_manifest:';
const CLOUDINARY_JSON_MAX_BYTES = 1024 * 1024;
const FORCE_RECHUNK = process.argv.includes('--force-rechunk');

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
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanId(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text ? text.replace(/\.0+$/, '') : '';
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

async function fetchAll(table, query) {
  const out = [];
  let from = 0;
  while (true) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: headers({ Range: `${from}-${from + 999}` })
    });
    if (!response.ok) throw new Error(await response.text());
    const part = await response.json();
    out.push(...part);
    console.log(`  ${table}: ${out.length.toLocaleString('es-AR')} filas leidas`);
    if (part.length < 1000) return out;
    from += 1000;
  }
}

async function uploadJson(payload, publicId) {
  const text = JSON.stringify(payload);
  const formData = new FormData();
  formData.append('file', new Blob([text], { type: 'application/json' }), `${publicId}.json`);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('public_id', publicId);
  formData.append('resource_type', 'raw');
  const response = await fetch(CLOUDINARY_RAW_UPLOAD_URL, { method: 'POST', body: formData });
  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) {}
  if (!response.ok) throw new Error(data?.error?.message || raw || 'Error subiendo JSON');
  if (!data?.secure_url) throw new Error('Cloudinary no devolvio URL');
  return data.secure_url;
}

function manifestUrlFromMeta(value) {
  const text = String(value || '').trim();
  return text.startsWith(PROVIDER_MANIFEST_PREFIX) ? text.slice(PROVIDER_MANIFEST_PREFIX.length) : '';
}

async function fetchRemoteMeta() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${META_TABLE}?id=eq.principal&select=lista_version,total_articulos,archivo_nombre,updated_at&limit=1`, {
    headers: headers()
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json())?.[0] || null;
}

async function fetchExistingManifest() {
  const meta = await fetchRemoteMeta().catch(() => null);
  const manifestUrl = manifestUrlFromMeta(meta?.archivo_nombre);
  if (!manifestUrl) return { meta, manifest: { providers: {} } };
  const response = await fetch(`${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
  if (!response.ok) throw new Error(await response.text());
  const manifest = await response.json();
  return {
    meta,
    manifest: {
      id: 'provider-json-manifest-v1',
      version: Number(manifest?.version || 0),
      updated_at: manifest?.updated_at || '',
      total_articulos: Number(manifest?.total_articulos || 0),
      providers: manifest?.providers && typeof manifest.providers === 'object' ? manifest.providers : {}
    }
  };
}

function providerJsonUrls(entry) {
  const chunks = Array.isArray(entry?.chunks) ? entry.chunks.map((chunk) => String(chunk?.json_url || '').trim()).filter(Boolean) : [];
  return chunks.length ? chunks : [String(entry?.json_url || '').trim()].filter(Boolean);
}

async function fetchRowsFromManifestEntry(entry) {
  const out = [];
  for (const url of providerJsonUrls(entry)) {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
    if (!response.ok) throw new Error(await response.text());
    const rows = await response.json();
    if (Array.isArray(rows)) out.push(...rows);
  }
  return out;
}

function normalizeArticle(row, index, providerMap) {
  const id = cleanId(row.id_proveedor);
  const providerName = String(row.proveedor || providerMap.get(id) || '').trim();
  const cod = String(row.cod_proveedor || '').trim();
  const article = String(row.articulo || '').trim();
  return {
    idorden: Number(row.idorden || 0) || Date.now() * 1000 + index,
    cod_proveedor: cod,
    articulo: article,
    precio_costo: Number(row.precio_costo || 0) || 0,
    id_proveedor: id,
    proveedor: providerName,
    cod_proveedor_norm: norm(row.cod_proveedor_norm || cod),
    articulo_norm: norm(row.articulo_norm || article),
    proveedor_norm: norm(row.proveedor_norm || providerName),
    articulo_source: row.articulo_source || 'provider_json_seed'
  };
}

async function publishManifest(manifest) {
  const manifestUrl = await uploadJson(manifest, `listas_proveedores/manifest_${manifest.version}`);
  const payload = {
    id: 'principal',
    lista_version: manifest.version,
    total_articulos: manifest.total_articulos,
    archivo_nombre: `${PROVIDER_MANIFEST_PREFIX}${manifestUrl}`
  };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${META_TABLE}?on_conflict=id`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await response.text());
  return manifestUrl;
}

async function main() {
  const started = Date.now();
  const version = Date.now();
  console.log('Leyendo manifest actual...');
  const existing = await fetchExistingManifest();
  const existingProviders = existing.manifest.providers || {};
  const existingCount = Object.values(existingProviders).filter((entry) => entry?.id_proveedor && providerJsonUrls(entry).length).length;
  console.log(`Manifest actual: ${existingCount} proveedor(es) con JSON.`);

  console.log('Leyendo proveedores...');
  const providers = await fetchAll(PROVIDERS_TABLE, 'select=id_proveedor,proveedor&order=proveedor.asc');
  const providerMap = new Map(providers.map((provider) => [cleanId(provider.id_proveedor), String(provider.proveedor || '').trim()]));

  console.log('Leyendo lista de precios completa...');
  const articles = await fetchAll(
    PRICE_TABLE,
    'select=idorden,cod_proveedor,articulo,precio_costo,id_proveedor,proveedor,cod_proveedor_norm,articulo_norm,proveedor_norm,articulo_source&order=id_proveedor.asc,idorden.asc'
  );

  const groups = new Map();
  let skipped = 0;
  articles.forEach((row, index) => {
    const article = normalizeArticle(row, index, providerMap);
    if (!article.id_proveedor) {
      skipped += 1;
      return;
    }
    if (!groups.has(article.id_proveedor)) groups.set(article.id_proveedor, []);
    groups.get(article.id_proveedor).push(article);
  });

  const entries = [...groups.entries()].sort((a, b) => String(providerMap.get(a[0]) || a[0]).localeCompare(String(providerMap.get(b[0]) || b[0]), 'es', { numeric: true, sensitivity: 'base' }));
  console.log(`Publicando ${entries.length} proveedor(es), ${articles.length.toLocaleString('es-AR')} articulos (${skipped} sin proveedor).`);

  const manifest = {
    id: 'provider-json-manifest-v1',
    version,
    updated_at: new Date().toISOString(),
    total_articulos: 0,
    providers: {}
  };

  for (let i = 0; i < entries.length; i += 1) {
    const [id, rows] = entries[i];
    const providerName = providerMap.get(id) || rows.find((row) => row.proveedor)?.proveedor || id;
    const existingEntry = existingProviders[id];
    if (existingEntry && providerJsonUrls(existingEntry).length && !FORCE_RECHUNK) {
      manifest.providers[id] = {
        ...existingEntry,
        id_proveedor: id,
        proveedor: existingEntry.proveedor || providerName
      };
      manifest.total_articulos += Number(existingEntry.total_articulos || rows.length);
      console.log(`[${i + 1}/${entries.length}] ${providerName} (${id}) - conserva JSON existente (${Number(existingEntry.total_articulos || rows.length).toLocaleString('es-AR')} articulos)`);
      continue;
    }
    const sourceRows = existingEntry && providerJsonUrls(existingEntry).length
      ? await fetchRowsFromManifestEntry(existingEntry)
      : rows;
    const chunks = splitJsonRows(sourceRows);
    const uploadedChunks = [];
    console.log(`[${i + 1}/${entries.length}] ${providerName} (${id}) - ${sourceRows.length.toLocaleString('es-AR')} articulos, ${chunks.length} JSON`);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const suffix = chunks.length > 1 ? `_parte_${chunkIndex + 1}` : '';
      const jsonUrl = await uploadJson(chunks[chunkIndex], `listas_proveedores/proveedor_${id}_${version}${suffix}`);
      uploadedChunks.push({
        index: chunkIndex + 1,
        total: chunks.length,
        rows: chunks[chunkIndex].length,
        json_url: jsonUrl
      });
      console.log(`    parte ${chunkIndex + 1}/${chunks.length}: ${chunks[chunkIndex].length.toLocaleString('es-AR')} articulos`);
    }
    manifest.providers[id] = {
      id_proveedor: id,
      proveedor: providerName,
      version,
      updated_at: manifest.updated_at,
      total_articulos: sourceRows.length,
      json_url: uploadedChunks[0]?.json_url || '',
      chunk_count: uploadedChunks.length,
      chunks: uploadedChunks
    };
    manifest.total_articulos += sourceRows.length;
  }

  for (const [id, entry] of Object.entries(existingProviders)) {
    if (manifest.providers[id] || !providerJsonUrls(entry).length) continue;
    manifest.providers[id] = entry;
    manifest.total_articulos += Number(entry.total_articulos || 0);
    console.log(`Conservado solo desde manifest: ${entry.proveedor || id} (${id}) - ${Number(entry.total_articulos || 0).toLocaleString('es-AR')} articulos`);
  }

  console.log('Subiendo manifest...');
  const manifestUrl = await publishManifest(manifest);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Listo. Manifest: ${manifestUrl}`);
  console.log(`Total publicado: ${manifest.total_articulos.toLocaleString('es-AR')} articulos en ${seconds}s.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
