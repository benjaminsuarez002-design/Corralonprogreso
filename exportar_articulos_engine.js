const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const OUTPUT_DIR = 'C:\\Update';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'Articulos.xls');

function xmlCell(value, type = 'String') {
  const text = String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<Cell><Data ss:Type="${type}">${text}</Data></Cell>`;
}

function buildExcelXml(articles) {
  const headers = ['IDArt', 'CodProveedor', 'Articulo', 'CodBarra', 'PrecioCosto', 'preciolista', 'PrecioVta', 'IDProveedor', 'IDRubro', 'IDMoneda', 'Nota', 'PorcIVA'];
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
  return out.join('');
}

function send(res, code, payload) {
  res.writeHead(code, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true, output: OUTPUT_FILE });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/export-articulos') {
    send(res, 404, { ok: false, error: 'Ruta no encontrada' });
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 100 * 1024 * 1024) req.destroy();
  });

  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const articles = Array.isArray(payload.articles) ? payload.articles : [];
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(OUTPUT_FILE, buildExcelXml(articles), 'utf8');
      send(res, 200, { ok: true, path: OUTPUT_FILE, rows: articles.length });
    } catch (error) {
      send(res, 500, { ok: false, error: error.message });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Motor de exportacion listo en http://127.0.0.1:${PORT}`);
  console.log(`Salida: ${OUTPUT_FILE}`);
});
