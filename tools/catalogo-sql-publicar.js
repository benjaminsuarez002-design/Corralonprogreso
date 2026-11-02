const fs = require('fs');
const {publish: publishCatalogVersion} = require('../catalogo-version-publish.js');
const path = require('path');
const crypto = require('crypto');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1];
}

const jsonPath = arg('--json');
const excelPath = arg('--excel');
const configPath = arg('--config', path.join(__dirname, 'catalogo-supabase.ini'));
const statePath = arg('--state', path.join(__dirname, 'catalogo-sync-state.json'));
const forceFull = process.argv.includes('--full');
const stateOnly = process.argv.includes('--state-only');
const batchSize = 500;
const concurrency = 4;

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

function embeddedSourceRows(rows) {
  if (!rows.some((row) => Array.isArray(row?.__source_rows))) return null;
  const grouped = new Map();
  let embeddedCount = 0;
  for (const row of rows) {
    const code = cleanId(row?.codigo ?? row?.idart);
    const sourceRows = Array.isArray(row?.__source_rows) ? row.__source_rows : [];
    grouped.set(code, sourceRows);
    embeddedCount += sourceRows.length;
  }
  const declaredTotal = Number(rows[0]?.__source_total_rows);
  return {
    grouped,
    totalRows: Number.isFinite(declaredTotal) && declaredTotal >= embeddedCount
      ? declaredTotal
      : embeddedCount
  };
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
    id_rubro: nullableNumber(row.id_rubro ?? row.idRubro ?? sourceRows?.[0]?.IDRubro ?? sourceRows?.[0]?.idrubro ?? sourceRows?.[0]?.id_rubro),
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

function rowHash(row) {
  return crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (state?.schema !== 1 || !state.hashes || typeof state.hashes !== 'object') return null;
    return state;
  } catch (_) {
    return null;
  }
}

function writeState(filePath, rows, version) {
  const hashes = {};
  for (const row of rows) hashes[row.codigo] = rowHash(row);
  const state = {
    schema: 1,
    version,
    updated_at: new Date().toISOString(),
    total_articulos: rows.length,
    hashes
  };
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state), 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (_) {
    fs.copyFileSync(tempPath, filePath);
    fs.unlinkSync(tempPath);
  }
}

async function processBatches(items, size, worker) {
  const batches = [];
  for (let offset = 0; offset < items.length; offset += size) {
    batches.push({ offset, rows: items.slice(offset, offset + size) });
  }
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      await worker(batch.rows, batch.offset);
    }
  });
  await Promise.all(runners);
}

async function postImport(endpoint, anonKey, token, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(120000),
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
  const { grouped, totalRows } = embeddedSourceRows(mergedRows) || (()=>{throw Error('Faltan filas SQL originales')})();
  const catalogRows = mergedRows.map((row) => {
    const code = cleanId(row.codigo ?? row.idart);
    return toCatalogRow(row, grouped.get(code) || []);
  });
  if (!catalogRows.length) throw new Error('El catalogo generado no contiene articulos');
  const version = Date.now();
  if (stateOnly) {
    writeState(statePath, catalogRows, version);
    log(`Estado diferencial inicial creado localmente: ${catalogRows.length} articulos; sin escribir en Supabase.`);
    return;
  }
  const endpoint = `${baseUrl}/functions/v1/importar-catalogo-articulos`;
  const sourceFile = path.basename(excelPath);
  let previousState = forceFull ? null : readState(statePath);
  const currentCodes = new Set(catalogRows.map((row) => row.codigo));
  if (previousState) {
    const oldCount = Object.keys(previousState.hashes).length;
    if (catalogRows.length < oldCount * .8) throw Error('El listado SQL perdio mas del 20% de articulos. Revisar antes de publicar.');
    const deltaCount = catalogRows.filter(row => previousState.hashes[row.codigo] !== rowHash(row)).length + Object.keys(previousState.hashes).filter(code => !currentCodes.has(code)).length;
    // La API limita delta_finalize a 2500 codigos; una sincronizacion completa no tiene ese limite.
    if (deltaCount > 2500) previousState = null;
  }
  const changedRows = previousState
    ? catalogRows.filter((row) => previousState.hashes[row.codigo] !== rowHash(row))
    : catalogRows;
  const removedCodes = previousState
    ? Object.keys(previousState.hashes).filter((code) => !currentCodes.has(code))
    : [];
  const isFullSync = !previousState;

  if (!changedRows.length && !removedCodes.length) {
    log(`Sin cambios: ${catalogRows.length} articulos ya estan sincronizados.`);
    return;
  }

  log(isFullSync
    ? `Primera base diferencial: subiendo ${catalogRows.length} articulos completos.`
    : `Cambios detectados: ${changedRows.length} para actualizar y ${removedCodes.length} para desactivar.`);
  log(`Lotes de ${batchSize}; hasta ${concurrency} solicitudes simultaneas.`);
  log('Las ediciones manuales se preservan: solo se reemplazan datos provenientes de SQL.');

  await processBatches(changedRows, batchSize, async (rows, offset) => {
    await postImport(endpoint, anonKey, importToken, {
      action: isFullSync ? 'batch' : 'delta_batch',
      version,
      source_file: sourceFile,
      rows
    });
    log(`Actualizados ${Math.min(offset + rows.length, changedRows.length)}/${changedRows.length}`);
  });

  if (isFullSync) {
    await postImport(endpoint, anonKey, importToken, {
      action: 'finalize',
      version,
      source_file: sourceFile,
      total_articulos: catalogRows.length,
      total_filas_fuente: totalRows
    });
  } else {
    await processBatches(removedCodes, batchSize, async (codes, offset) => {
      await postImport(endpoint, anonKey, importToken, {
        action: 'delta_remove',
        version,
        removed_codes: codes
      });
      log(`Desactivados ${Math.min(offset + codes.length, removedCodes.length)}/${removedCodes.length}`);
    });
    await postImport(endpoint, anonKey, importToken, {
      action: 'delta_finalize',
      version,
      source_file: sourceFile,
      total_articulos: catalogRows.length,
      total_filas_fuente: totalRows,
      changed_codes: changedRows.map((row) => row.codigo),
      removed_codes: removedCodes
    });
  }

  const publicCount = await countPublicRows(baseUrl, anonKey);
  if (publicCount !== catalogRows.length) {
    throw new Error(`La vista publica devuelve ${publicCount} articulos y se esperaban ${catalogRows.length}`);
  }
  await publishCatalogVersion();
  writeState(statePath, catalogRows, version);
  log(`Supabase actualizado y estado diferencial guardado. Version ${version}; ${publicCount} articulos; ${totalRows} filas fuente.`);
}

main().catch((error) => {
  console.error('[CATALOGO] ERROR:', error.message || error);
  process.exit(1);
});
