const fs = require('fs');
const path = require('path');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1];
}

const configPath = arg('--config', path.join(__dirname, 'catalogo-supabase.ini'));
const metadataUrl = arg(
  '--url',
  'https://res.cloudinary.com/do0i2da7h/raw/upload/v1785156361/articulos_meta_1785156360174'
);
const batchSize = 350;

function cleanId(value) {
  return String(value ?? '').trim().replace(/\.0+$/, '');
}

function readIni(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`No existe la configuracion: ${filePath}`);
  const result = {};
  let section = '';
  for (const rawLine of fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    result[section ? `${section}.${key}` : key] = value;
  }
  return result;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, cache: 'no-store' });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {}
  if (!response.ok) throw new Error(data?.error || text || `HTTP ${response.status}`);
  return data;
}

async function postImport(endpoint, anonKey, token, payload) {
  return requestJson(endpoint, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

async function loadActiveCodes(baseUrl, anonKey) {
  const result = new Set();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await requestJson(
      `${baseUrl}/rest/v1/catalogo_articulos?select=codigo&activo=eq.true&order=codigo.asc`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Range: `${offset}-${offset + pageSize - 1}`
        }
      }
    );
    const page = Array.isArray(rows) ? rows : [];
    page.forEach((row) => {
      const codigo = cleanId(row.codigo);
      if (codigo) result.add(codigo);
    });
    if (page.length < pageSize) break;
  }
  return result;
}

async function main() {
  const config = readIni(configPath);
  const baseUrl = String(config['supabase.url'] || '').replace(/\/+$/, '');
  const anonKey = String(config['supabase.anonkey'] || '');
  const importToken = String(config['supabase.importtoken'] || '');
  if (!baseUrl || !anonKey || !importToken) {
    throw new Error('La seccion [Supabase] requiere Url, AnonKey e ImportToken');
  }

  console.log('[METADATA] Descargando el respaldo existente de Cloudinary. No se eliminara ni modificara.');
  const source = await requestJson(metadataUrl);
  const incoming = Array.isArray(source) ? source : Array.isArray(source?.articulos) ? source.articulos : [];
  if (!incoming.length) throw new Error('El respaldo de Cloudinary no contiene articulos');

  const activeCodes = await loadActiveCodes(baseUrl, anonKey);
  const unique = new Map();
  for (const row of incoming) {
    const codigo = cleanId(row?.codigo ?? row?.idart ?? row?.idArt);
    if (codigo && activeCodes.has(codigo)) unique.set(codigo, { ...row, codigo });
  }
  const rows = [...unique.values()];
  if (!rows.length) throw new Error('No hay metadatos compatibles con el catalogo activo');

  const endpoint = `${baseUrl}/functions/v1/importar-catalogo-articulos`;
  const version = Date.now();
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    await postImport(endpoint, anonKey, importToken, {
      action: 'metadata_batch',
      version,
      updated_by: 'migracion_cloudinary_unica',
      rows: batch
    });
    console.log(`[METADATA] Lote ${Math.min(offset + batch.length, rows.length)}/${rows.length}`);
  }

  const result = await postImport(endpoint, anonKey, importToken, {
    action: 'metadata_finalize',
    version
  });
  if (Number(result?.total_metadatos || 0) < rows.length) {
    throw new Error(`Supabase informa ${result?.total_metadatos || 0} metadatos y se migraron ${rows.length}`);
  }
  console.log(`[METADATA] Migracion finalizada: ${rows.length} articulos. Cloudinary permanece intacto.`);
}

main().catch((error) => {
  console.error('[METADATA] ERROR:', error.message || error);
  process.exit(1);
});
