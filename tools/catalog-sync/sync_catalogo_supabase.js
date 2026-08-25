const fs = require('fs');
const path = require('path');

let XLSX;
try {
  XLSX = require('xlsx');
} catch (error) {
  console.error('[CATALOGO] Falta dependencia "xlsx".');
  process.exit(2);
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1];
}

const jsonPath = arg('--json');
const excelPath = arg('--excel');
const configPath = arg('--config', path.join(__dirname, 'catalogo-supabase.ini'));
const batchSize = 350;

function log(message) {
  console.log(`[CATALOGO] ${message}`);
}

function cleanId(value) {
  const text = String(value ?? '').trim();
  return text ? text.replace(/\.0+$/, '') : '';
}

function number(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function nullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readIni(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`No existe la configuracion: ${filePath}`);
  const result = {};
  let section = '';
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const rawLine of lines) {
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

function rawRowsByCode(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`No existe el Excel: ${filePath}`);
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true });
  const grouped = new Map();
  for (const row of rows) {
    let code = '';
    for (const [key, value] of Object.entries(row)) {
      const normalized = normalizeKey(key);
      if (['idart', 'id_art', 'codigo', 'codigointerno'].includes(normalized)) {
        code = cleanId(value);
        if (code) break;
      }
    }
    if (!code) continue;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(row);
  }
  return { grouped, totalRows: rows.length };
}

function toCatalogRow(row, sourceRows) {
  const codigo = cleanId(row.codigo ?? row.idart);
  const codigoProveedor = String(row.idartprov ?? row.codprov ?? '').trim();
  const idProveedor = cleanId(row.id_proveedor ?? row.idProveedor);
  return {
    codigo,
    codigo_proveedor: codigoProveedor || null,
    id_proveedor: idProveedor || null,
    nombre: String(row.nombre ?? row.descripcion ?? '').trim(),
    rubro: String(row.rubro ?? '').trim() || null,
    precio_compra_sin_descuento: number(row.PrecioCpraSISDto ?? row.precioCosto ?? row.precio_costo),
    precio_compra_con_impuestos: number(row.PrecioCpraCI ?? row.precioCpraCI),
    porcentaje_ganancia_min: number(row.PorcGanMin ?? row.porcGanMin),
    precio_venta: number(row.PrecioVta3 ?? row.precioVta3 ?? row.precio),
    stock: nullableNumber(row.stock),
    stock_progreso: nullableNumber(row.stockSucursalProgresoRuta),
    stock_calle5: nullableNumber(row.stockSucursalCalle5Espana),
    source_rows: sourceRows || []
  };
}

async function postImport(endpoint, anonKey, token, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {}
  if (!response.ok) throw new Error(data?.error || text || `HTTP ${response.status}`);
  return data;
}

async function countPublicRows(baseUrl, anonKey) {
  const response = await fetch(
    `${baseUrl}/rest/v1/catalogo_articulos_publico?select=codigo&activo=eq.true&limit=1`,
    {
      method: 'HEAD',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Prefer: 'count=exact'
      },
      cache: 'no-store'
    }
  );
  if (!response.ok) throw new Error(`No se pudo verificar la vista publica: HTTP ${response.status}`);
  const contentRange = String(response.headers.get('content-range') || '');
  const total = Number(contentRange.split('/').pop());
  return Number.isFinite(total) ? total : -1;
}

async function main() {
  if (!jsonPath || !excelPath) {
    throw new Error('Uso: node sync_catalogo_supabase.js --json <catalogo.json> --excel <Articulosexp.xls> --config <catalogo-supabase.ini>');
  }
  if (!fs.existsSync(jsonPath)) throw new Error(`No existe el JSON: ${jsonPath}`);

  const config = readIni(configPath);
  const baseUrl = String(config['supabase.url'] || '').replace(/\/+$/, '');
  const anonKey = String(config['supabase.anonkey'] || '');
  const importToken = String(config['supabase.importtoken'] || '');
  if (!baseUrl || !anonKey || !importToken) {
    throw new Error('La seccion [Supabase] requiere Url, AnonKey e ImportToken');
  }

  const incoming = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const mergedRows = (Array.isArray(incoming) ? incoming : [incoming]).filter((row) => cleanId(row?.codigo ?? row?.idart));
  const { grouped, totalRows } = rawRowsByCode(excelPath);
  const catalogRows = mergedRows.map((row) => {
    const code = cleanId(row.codigo ?? row.idart);
    return toCatalogRow(row, grouped.get(code) || []);
  });
  const version = Date.now();
  const endpoint = `${baseUrl}/functions/v1/importar-catalogo-articulos`;
  const sourceFile = path.basename(excelPath);

  log(`Subiendo ${catalogRows.length} articulos completos a Supabase...`);
  log('Las ediciones manuales se preservan: este proceso solo reemplaza los datos provenientes del Excel.');
  for (let offset = 0; offset < catalogRows.length; offset += batchSize) {
    const rows = catalogRows.slice(offset, offset + batchSize);
    await postImport(endpoint, anonKey, importToken, {
      action: 'batch',
      version,
      source_file: sourceFile,
      rows
    });
    log(`Lote ${Math.min(offset + rows.length, catalogRows.length)}/${catalogRows.length}`);
  }

  await postImport(endpoint, anonKey, importToken, {
    action: 'finalize',
    version,
    source_file: sourceFile,
    total_articulos: catalogRows.length,
    total_filas_fuente: totalRows
  });

  const publicCount = await countPublicRows(baseUrl, anonKey);
  if (publicCount !== catalogRows.length) {
    throw new Error(`La vista publica devuelve ${publicCount} articulos y se esperaban ${catalogRows.length}`);
  }
  log(`Supabase actualizado y verificado. Version ${version}; ${publicCount} articulos; ${totalRows} filas fuente.`);
}

main().catch((error) => {
  console.error('[CATALOGO] ERROR:', error.message || error);
  process.exit(1);
});
