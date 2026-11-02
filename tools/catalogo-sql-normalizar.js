const fs = require('fs');
const path = require('path');

function arg(name, def='') {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return def;
  return process.argv[idx + 1];
}

const excelPath = arg('--excel');
const outPath = arg('--out');
if (!excelPath || !outPath) {
  console.error('[SYNC] Uso: node parse_excel_to_json.js --excel <ruta.xls/xlsx> --out <salida.json>');
  process.exit(1);
}

if (!fs.existsSync(excelPath)) {
  console.error('[SYNC] No existe Excel:', excelPath);
  process.exit(1);
}

function normKey(k) {
  return String(k || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '_');
}

function parsePrecio(v) {
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim().replace(/[^0-9,.-]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) { s = s.replace(/\./g, ''); s = s.replace(/,/g, '.'); }
    else { s = s.replace(/,/g, ''); }
  } else if (lastComma > -1) {
    s = s.replace(/\./g, ''); s = s.replace(/,/g, '.');
  } else {
    if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function parseCantidad(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().replace(/[^0-9,.-]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) { s = s.replace(/\./g, ''); s = s.replace(/,/g, '.'); }
    else { s = s.replace(/,/g, ''); }
  } else if (lastComma > -1) {
    s = s.replace(/\./g, ''); s = s.replace(/,/g, '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function cleanId(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  return text.replace(/\.0+$/, '');
}

function sourceRowCode(row) {
  for (const [key, value] of Object.entries(row || {})) {
    const normalized = normKey(key);
    if (['idart', 'id_art', 'codigo', 'codigointerno'].includes(normalized)) {
      const code = cleanId(value);
      if (code) return code;
    }
  }
  return '';
}

function groupSourceRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const code = sourceRowCode(row);
    if (!code) continue;
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(row);
  }
  return grouped;
}

function normalizeRow(r) {
  const out = {};
  for (const k of Object.keys(r)) {
    const v = r[k];
    const key = normKey(k);

    if (['idart','id_art','id','codigointerno','idartext'].includes(key)) out.idart = v;
    else if (['codigo','code','cod'].includes(key)) out.codigo = v;
    else if (['idartprov','id_art_prov','idart_prov','idartprov_','artprov','idproveedorarticulo'].includes(key)) out.idartprov = v;
    else if (['codprov','cod_prov','codigo_proveedor','codigoproveedor','codigo_prov','codproveedor'].includes(key)) out.idartprov = v;
    else if (['idproveedor','id_proveedor','idprov','id_prov','proveedor_id','idproveed','id_proveed','idprove','id_prove','idproveedorarticulo','id_proveedor_articulo'].includes(key)) out.idproveedor = v;
    else if (['aaarticulos_descripcion','aarticulos_descripcion','articulos_descripcion','articulo_descripcion','descripcion','description','nombre','name','desc'].includes(key)) out.nombre = v;
    else if (['preciocpraci','precio_cpra_ci','precio_compra_ci','precio_compra_con_impuestos'].includes(key)) out.precioCpraCI = v;
    else if (['preciocprasisdto','precio_cpra_sis_dto','precio_compra_sis_dto','preciocosto','preciocost','precio_costo','precio_cost','precio_de_costo','cost','costo'].includes(key)) out.precioCosto = v;
    else if (['preciovta3','preciovta_3'].includes(key)) { out.precioVta3 = v; out.precio = v; }
    else if (['preciovta2','preciovta_2','preciovta1','preciovta_1','preciovta','precio','price','valor','amount','importe'].includes(key)) out.precio = v;
    else if (['porcganmin','porc_gan_min','porcentaje_ganancia_min','margen_minimo'].includes(key)) out.porcGanMin = v;
    else if (['detalle','detalle_largo','description_long','notas'].includes(key)) out.detalle = v;
    else if (['fotourl','foto_url','imagen','imageurl','image_url','urlimagen','url_imagen'].includes(key)) out.fotoUrl = v;
    else if (['imagenes','fotos','galeria','fotourls','foto_urls'].includes(key)) out.imagenes = v;
    else if (['idrubro','id_rubro','rubro_id'].includes(key)) out.idRubro = v;
    else if (['rubros_descripcion','rubro_descripcion','rubros','rubro','category','categoria'].includes(key)) out.rubro = v;
    else if (['stock','stockact','stock_act','existencia','cantidad','stkact'].includes(key)) out.stock = v;
    else if (['idsuc','id_suc','idsucursal','id_sucursal','sucursal_id'].includes(key)) out.idsuc = v;
    else out[key] = v;
  }

  const codigo = String(out.codigo ?? out.idart ?? '').trim();
  const nombre = String(out.nombre ?? '').trim();
  if (!codigo) return null;

  return {
    codigo,
    idartprov: String(out.idartprov ?? out.codprov ?? '').trim(),
    codprov: String(out.idartprov ?? out.codprov ?? '').trim(),
    id_proveedor: cleanId(out.idproveedor ?? out.id_proveedor ?? out.idproveed ?? out.id_proveed ?? ''),
    idProveedor: cleanId(out.idproveedor ?? out.id_proveedor ?? out.idproveed ?? out.id_proveed ?? ''),
    idsuc: cleanId(out.idsuc ?? out.id_suc ?? out.idsucursal ?? out.id_sucursal ?? ''),
    nombre,
    detalle: String(out.detalle ?? '').trim(),
    fotoUrl: String(out.fotoUrl ?? '').trim(),
    imagenes: String(out.imagenes ?? '').trim(),
    precio: parsePrecio(out.precio ?? out.precioCosto),
    precioCosto: parsePrecio(out.precioCosto ?? out.precio),
    precio_costo: parsePrecio(out.precioCosto ?? out.precio),
    PrecioCpraCI: parsePrecio(out.precioCpraCI ?? out.precioCosto ?? out.precio),
    PrecioVta3: parsePrecio(out.precioVta3 ?? out.precio ?? out.precioCosto),
    PorcGanMin: parseCantidad(out.porcGanMin) ?? 0,
    id_rubro: cleanId(out.idRubro ?? out.idrubro ?? out.id_rubro ?? ''),
    idRubro: cleanId(out.idRubro ?? out.idrubro ?? out.id_rubro ?? ''),
    rubro: String(out.rubro ?? '').trim(),
    stock: out.stock === undefined || out.stock === null ? '' : String(out.stock).trim()
  };
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return '';
}

function mergeRowsByArticulo(rows) {
  const byCode = new Map();
  for (const row of rows) {
    const codigo = cleanId(row?.codigo || row?.idart || '');
    if (!codigo) continue;
    const current = byCode.get(codigo) || {
      codigo,
      idartprov: '',
      codprov: '',
      id_proveedor: '',
      idProveedor: '',
      nombre: '',
      detalle: '',
      fotoUrl: '',
      imagenes: '',
      precio: 0,
      precioCosto: 0,
      precio_costo: 0,
      PrecioCpraCI: 0,
      PrecioVta3: 0,
      PorcGanMin: 0,
      id_rubro: '',
      idRubro: '',
      rubro: '',
      stock: '',
      stockSucursalProgresoRuta: '',
      stockSucursalCalle5Espana: ''
    };

    current.idartprov = pickFirst(current.idartprov, row.idartprov, row.codprov);
    current.codprov = pickFirst(current.codprov, row.codprov, row.idartprov);
    current.id_proveedor = pickFirst(current.id_proveedor, row.id_proveedor, row.idProveedor);
    current.idProveedor = pickFirst(current.idProveedor, row.idProveedor, row.id_proveedor);
    current.nombre = pickFirst(current.nombre, row.nombre);
    current.detalle = pickFirst(current.detalle, row.detalle);
    current.fotoUrl = pickFirst(current.fotoUrl, row.fotoUrl);
    current.imagenes = pickFirst(current.imagenes, row.imagenes);
    current.rubro = pickFirst(current.rubro, row.rubro);
    current.id_rubro = pickFirst(current.id_rubro, row.id_rubro, row.idRubro);
    current.idRubro = pickFirst(current.idRubro, row.idRubro, row.id_rubro);
    current.precio = Number.isFinite(Number(current.precio)) && Number(current.precio) > 0 ? Number(current.precio) : Number(row.precio || 0);
    current.precioCosto = Number.isFinite(Number(current.precioCosto)) && Number(current.precioCosto) > 0 ? Number(current.precioCosto) : Number(row.precioCosto || row.precio_costo || 0);
    current.precio_costo = current.precioCosto;
    current.PrecioCpraCI = Number.isFinite(Number(current.PrecioCpraCI)) && Number(current.PrecioCpraCI) > 0 ? Number(current.PrecioCpraCI) : Number(row.PrecioCpraCI || 0);
    current.PrecioVta3 = Number.isFinite(Number(current.PrecioVta3)) && Number(current.PrecioVta3) > 0 ? Number(current.PrecioVta3) : Number(row.PrecioVta3 || row.precio || 0);
    current.PorcGanMin = Number.isFinite(Number(row.PorcGanMin)) ? Number(row.PorcGanMin) : Number(current.PorcGanMin || 0);

    const stockValue = parseCantidad(row.stock);
    if (row.idsuc === '1') current.stockSucursalProgresoRuta = stockValue === null ? current.stockSucursalProgresoRuta : stockValue;
    else if (row.idsuc === '2') current.stockSucursalCalle5Espana = stockValue === null ? current.stockSucursalCalle5Espana : stockValue;
    else if (stockValue !== null && (current.stock === '' || current.stock === null || current.stock === undefined)) current.stock = stockValue;

    byCode.set(codigo, current);
  }

  return [...byCode.values()].map((row) => {
    const progreso = parseCantidad(row.stockSucursalProgresoRuta);
    const calle5 = parseCantidad(row.stockSucursalCalle5Espana);
    if (progreso !== null || calle5 !== null) {
      row.stock = Number(((progreso || 0) + (calle5 || 0)).toFixed(2));
      row.stockSucursalProgresoRuta = progreso === null ? '' : progreso;
      row.stockSucursalCalle5Espana = calle5 === null ? '' : calle5;
    } else {
      const total = parseCantidad(row.stock);
      row.stock = total === null ? '' : total;
    }
    return row;
  });
}

const rows = JSON.parse(fs.readFileSync(excelPath, 'utf8').replace(/^\uFEFF/,''));
const parsed = rows.map(normalizeRow).filter(Boolean);
const missingProvider = parsed.filter(r => !cleanId(r.id_proveedor || r.idProveedor));
if (missingProvider.length) {
  console.error(`[SYNC] ERROR: ${missingProvider.length} articulos quedaron sin ID Proveedor. No se publica la lista.`);
  missingProvider.slice(0, 20).forEach((r) => {
    console.error(`[SYNC] Sin ID Proveedor -> codigo=${r.codigo || ''} codprov=${r.codprov || ''} nombre=${r.nombre || ''}`);
  });
  console.error('[SYNC] Revisa que el Excel tenga una columna ID Proveedor / IDProveedor / IDProv para todos los articulos.');
  process.exit(1);
}

const finalRows = mergeRowsByArticulo(parsed);
const sourceRowsByCode = groupSourceRows(rows);
for (const row of finalRows) {
  row.__source_rows = sourceRowsByCode.get(cleanId(row.codigo)) || [];
}
if (finalRows.length) finalRows[0].__source_total_rows = rows.length;

fs.writeFileSync(outPath, JSON.stringify(finalRows), 'utf8');
console.log(`[SYNC] Filas leidas: ${rows.length}`);
console.log(`[SYNC] Filas validas: ${finalRows.length}`);
console.log('[SYNC] JSON generado:', outPath);
