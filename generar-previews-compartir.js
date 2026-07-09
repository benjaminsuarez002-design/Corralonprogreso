const fs = require('fs');
const path = require('path');

const FIRESTORE_PROJECT = 'corralon-progreso';
const SITE_URL = 'https://corralonprogreso.com';
const OUT_DIR = path.join(__dirname, 'compartir');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanCode(value) {
  return String(value ?? '').trim();
}

function shareFileName(code) {
  return cleanCode(code)
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'articulo';
}

function firstImage(article = {}) {
  const images = Array.isArray(article.imagenes) ? article.imagenes : [];
  return String(images.find((url) => String(url || '').trim()) || article.fotoUrl || '').trim();
}

function articleTitle(article = {}) {
  return String(article.nombre || article.descripcion || article.articulo || article.detalle || article.codigo || 'Articulo Corralon Progreso').trim();
}

function fmtPrice(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '';
  return `$ ${number.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function firestoreString(doc, field) {
  const value = doc?.fields?.[field];
  return value?.stringValue || value?.integerValue || value?.doubleValue || '';
}

async function getConfigUrl(docId) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/config/${docId}`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`No pude leer config/${docId}: HTTP ${response.status}`);
  const json = await response.json();
  return String(firestoreString(json, 'url') || '').trim();
}

async function readJson(url) {
  if (!url) return [];
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
  if (!response.ok) throw new Error(`No pude leer JSON: HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error('El JSON publicado no es una lista');
  return json;
}

function metaMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const code = cleanCode(row.codigo ?? row.idart ?? row.idArt ?? row.id);
    if (code) map.set(code, row);
  }
  return map;
}

function mergeArticle(base = {}, meta = {}) {
  const images = [
    ...(Array.isArray(meta.imagenes) ? meta.imagenes : []),
    meta.fotoUrl,
    base.fotoUrl,
    base.imagen
  ].map((url) => String(url || '').trim()).filter(Boolean);
  return {
    ...base,
    ...meta,
    codigo: cleanCode(base.codigo ?? base.idart ?? meta.codigo ?? meta.idart),
    nombre: articleTitle({ ...base, ...meta }),
    precio: Number(base.precioVigente ?? base.precio ?? meta.precio ?? 0) || 0,
    fotoUrl: images[0] || '',
    imagenes: [...new Set(images)]
  };
}

function buildShareHtml(article) {
  const code = cleanCode(article.codigo);
  const title = articleTitle(article);
  const image = firstImage(article);
  const price = fmtPrice(article.precio);
  const detail = String(article.detalle || article.rubro || '').trim();
  const description = [price, detail, code ? `Codigo: ${code}` : '', 'Corralon Progreso'].filter(Boolean).join(' - ');
  const target = `${SITE_URL}/index.html?articulo=${encodeURIComponent(code)}`;
  const canonical = `${SITE_URL}/compartir/${shareFileName(code)}.html`;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Corralon Progreso</title>
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="Corralon Progreso">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:secure_url" content="${escapeHtml(image)}">
  <meta property="og:image:alt" content="${escapeHtml(title)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="1200">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
  <script>location.replace(${JSON.stringify(target)});</script>
</head>
<body>
  <a href="${escapeHtml(target)}">Abrir articulo</a>
</body>
</html>
`;
}

async function main() {
  const [baseUrl, metaUrl] = await Promise.all([
    getConfigUrl('listaActual'),
    getConfigUrl('listaMetaArticulos')
  ]);
  const [baseRows, metaRows] = await Promise.all([
    readJson(baseUrl),
    readJson(metaUrl)
  ]);
  const metas = metaMap(metaRows);
  const articles = baseRows
    .map((row) => {
      const code = cleanCode(row.codigo ?? row.idart ?? row.idArt ?? row.id);
      return mergeArticle(row, metas.get(code) || {});
    })
    .filter((article) => cleanCode(article.codigo) && firstImage(article));

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const article of articles) {
    fs.writeFileSync(path.join(OUT_DIR, `${shareFileName(article.codigo)}.html`), buildShareHtml(article), 'utf8');
  }
  console.log(`Previews generados: ${articles.length}`);
  console.log(`Carpeta: ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
