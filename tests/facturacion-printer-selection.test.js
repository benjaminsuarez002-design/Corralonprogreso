const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
const start = html.indexOf('let printerOptionsInitialized=false;');
const end = html.indexOf('async function loadSqlCatalog(){', start);
assert.ok(start >= 0 && end > start, 'Debe existir la consulta de impresoras');
const loadTicketPrinters = html.slice(start, end);

async function run(saved, installed, localInstalled = [], hostname = 'localhost', currentSelection = null) {
  const elements = {
    '#ticketPrinter': { value: 'anterior', innerHTML: '' },
    '#previewPrinter': { value: 'anterior', innerHTML: '' },
    '#printerSetupChoice': { value: 'anterior', innerHTML: '' },
    '#doPrintTrial': { disabled: false },
    '#trialModal': { classList: { contains: () => false } },
  };
  const context = {
    $: selector => elements[selector],
    SQL_PREPARACION: 'http://localhost:8081',
    LOCAL_PRINTER_API: 'http://127.0.0.1:8082',
    BROWSER_PRINTER: 'browser:',
    TICKET_PRINTER_KEY: 'facturacion_ticket_printer_v1',
    location: { hostname },
    AbortSignal,
    localStorage: { getItem: () => saved },
    fetch: async url => ({ ok: true, json: async () => ({ ok: true, impresoras: String(url).includes('127.0.0.1:8082') ? localInstalled : installed }) }),
    esc: text => text,
    issuedReceipt: null,
    previewDraft: null,
  };
  const load = vm.runInNewContext(`${loadTicketPrinters};loadTicketPrinters`, context);
  await load();
  if (currentSelection !== null) {
    elements['#ticketPrinter'].value = currentSelection;
    await load();
  }
  return elements;
}

test('sin ticketera guardada no elige la primera impresora por accidente', async () => {
  const elements = await run('', ['POS-80 A', 'POS-80 B']);
  assert.equal(elements['#ticketPrinter'].value, '');
  assert.equal(elements['#previewPrinter'].value, '');
  assert.match(elements['#previewPrinter'].innerHTML, /POS-80 B/);
});

test('la ticketera guardada solo se usa si sigue instalada', async () => {
  assert.equal((await run('POS-80 B', ['POS-80 A', 'POS-80 B']))['#ticketPrinter'].value, 'server:POS-80 B');
  assert.equal((await run('POS-80 B', ['POS-80 A']))['#ticketPrinter'].value, '');
});

test('otra PC ofrece su impresora local sin imprimir automáticamente si no se eligió destino', async () => {
  const elements = await run('', ['POS-80 servidor'], ['Ticketera sucursal'], '192.168.100.28');
  assert.equal(elements['#ticketPrinter'].value, '');
  assert.match(elements['#ticketPrinter'].innerHTML, /Esta PC · Ticketera sucursal/);
  assert.match(elements['#ticketPrinter'].innerHTML, /Servidor · POS-80 servidor/);
  assert.equal((await run('local:Ticketera sucursal', [], ['Ticketera sucursal'], '192.168.100.28'))['#ticketPrinter'].value, 'local:Ticketera sucursal');
});

test('actualizar impresoras respeta la selección visible, incluso si se quitó', async () => {
  assert.equal((await run('POS-80 B', ['POS-80 B'], [], 'localhost', 'browser:'))['#ticketPrinter'].value, 'browser:');
  assert.equal((await run('POS-80 B', ['POS-80 B'], [], 'localhost', ''))['#ticketPrinter'].value, '');
});

test('al terminar la impresión del navegador libera el comprobante emitido', async () => {
  const start = html.indexOf("window.addEventListener('afterprint'");
  const end = html.indexOf('\n', start);
  assert.ok(start >= 0 && end > start);
  let handler, closed = 0, message = '';
  const context = {
    window: { addEventListener: (_, callback) => { handler = callback; } },
    browserPrintPending: true, printerSelectionPending: true, reviewBrowserPrintPending: false,
    previewDraft: null, issuedReceipt: { numero: '0007-00000260' },
    closeTrial: () => { closed++; }, setMsg: text => { message = text; },
    loadSqlCatalog: async () => {}, console,
  };
  vm.runInNewContext(html.slice(start, end), context);
  handler();
  assert.equal(closed, 1);
  assert.equal(context.browserPrintPending, false);
  assert.match(message, /0007-00000260/);
});
