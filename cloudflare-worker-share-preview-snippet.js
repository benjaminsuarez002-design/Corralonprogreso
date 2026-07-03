// PEGAR EN TU WORKER DE CLOUDFLARE.
// 1) Pegá estas funciones antes de `export default`.
// 2) Al principio de `async fetch(request)`, después del OPTIONS, pegá:
//    const previewResponse = await tryCorralonSharePreview(request);
//    if (previewResponse) return previewResponse;

function htmlAttrSharePreview(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanHttpUrlSharePreview(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function buildCorralonShareMeta(url) {
  const codigo = String(url.searchParams.get('articulo') || '').trim();
  const image = cleanHttpUrlSharePreview(url.searchParams.get('previewImg'));
  if (!codigo || !image) return '';

  const title = String(url.searchParams.get('previewTitulo') || 'Articulo Corralon Progreso').trim();
  const price = String(url.searchParams.get('previewPrecio') || '').trim();
  const description = price
    ? `${price} - Codigo: ${codigo} - Corralon Progreso`
    : `Codigo: ${codigo} - Corralon Progreso`;

  return `
<!-- corralon-share-preview-meta -->
<meta property="og:type" content="product">
<meta property="og:site_name" content="Corralon Progreso">
<meta property="og:title" content="${htmlAttrSharePreview(title)}">
<meta property="og:description" content="${htmlAttrSharePreview(description)}">
<meta property="og:url" content="${htmlAttrSharePreview(url.toString())}">
<meta property="og:image" content="${htmlAttrSharePreview(image)}">
<meta property="og:image:secure_url" content="${htmlAttrSharePreview(image)}">
<meta property="og:image:alt" content="${htmlAttrSharePreview(title)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1200">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${htmlAttrSharePreview(title)}">
<meta name="twitter:description" content="${htmlAttrSharePreview(description)}">
<meta name="twitter:image" content="${htmlAttrSharePreview(image)}">
`;
}

async function tryCorralonSharePreview(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const host = url.hostname.toLowerCase();
  const shouldInject =
    request.method === 'GET' &&
    (host === 'corralonprogreso.com' || host.endsWith('.corralonprogreso.com')) &&
    (path === '/' || path.toLowerCase() === '/index.html') &&
    url.searchParams.has('articulo') &&
    url.searchParams.has('previewImg');

  if (!shouldInject) return null;

  const response = await fetch(request);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;

  const meta = buildCorralonShareMeta(url);
  if (!meta) return response;

  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.delete('content-length');

  const output = html.replace(/<\/head>/i, `${meta}</head>`);
  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
