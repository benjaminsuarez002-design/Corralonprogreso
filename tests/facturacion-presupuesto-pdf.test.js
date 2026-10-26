const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
const shared = fs.readFileSync(path.join(__dirname, '..', 'presupuesto-shared.js'), 'utf8');
const from = html.indexOf('function reserveBudgetPreview(){');
const to = html.indexOf('async function issue(){', from);
assert.ok(from >= 0 && to > from);

test('la fecha SQL del presupuesto se muestra como fecha argentina', () => {
  const start = shared.indexOf('function normalizarFecha(fecha) {');
  const end = shared.indexOf('function ensureLogoDataUrl(url) {', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(shared.slice(start, end), context);
  assert.equal(context.normalizarFecha('/Date(1790305200000)/'), '25/09/2026');
  assert.equal(context.normalizarFecha('25/09/2026'), '25/09/2026');
});

test('el presupuesto confirmado usa el generador de index con título y cliente separados', async () => {
  let pdfInput;
  const popup = { closed: false, location: { href: '' } };
  class PdfURL extends URL {}
  PdfURL.createObjectURL = () => 'blob:presupuesto';
  PdfURL.revokeObjectURL = () => {};
  const context = {
    window: { jspdf: { jsPDF() {} }, PresupuestoShared: {
      ensureLogoDataUrl: async () => 'data:image/png;base64,bG9nbw==',
      generarPDFPresupuestoDoc(input) { pdfInput = input; return { output: () => new Blob(['pdf']), setProperties() {} }; },
    } },
    SQL_PREPARACION: '/api/facturacion',
    fetch: async () => ({ ok: true, json: async () => ({ ok: true,
      comprobante: { confirmado: -1, anulada: 0, idComprobante: 43, numero: '0007-00034024', totalAbsoluto: 6450, cliente: 'BENJA', fecha: '2026-09-25' },
      articulos: [{ idart: '000010', descripcion: 'CEMENTO', cantidad: 1, precio: 6450 }],
    }) }),
    URL: PdfURL, Blob, setTimeout() {}, location: { href: 'http://localhost:8080/gestion.html' },
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  const data = { idComprobante: 43, cliente: { nombre: 'BENJA' }, totales: { total: 6450 }, articulos: [{}], nota: '' };
  await context.openBudgetPreview(data, { idRecibo: 123, numero: '0007-00034024' }, popup);
  assert.equal(pdfInput.headerName, 'Presupuesto');
  assert.equal(pdfInput.subtitle, 'BENJA');
  assert.equal(pdfInput.numero, '0007-00034024');
  assert.equal(pdfInput.items[0].nombre, 'CEMENTO');
  assert.equal(popup.location.href, 'blob:presupuesto');
});
