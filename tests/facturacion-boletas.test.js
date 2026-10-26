const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
const from = html.indexOf('let associatedReceiptId=0;');
const to = html.indexOf('function lockIssued(){', from);
assert.ok(from >= 0 && to > from);

test('copiar una boleta no la asocia a una nueva venta, pero sí a una nota de crédito', () => {
  let type = 13;
  const fields = {
    '#invoiceReference': { value: '0007-00012303' },
    '#customerTax': { value: 'Consumidor final' },
    '#customerTaxShort': { textContent: '' },
  };
  const context = {
    formData: () => ({ idComprobante: type, facturaAsociada: type === 5 ? fields['#invoiceReference'].value : '' }),
    $: selector => fields[selector],
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  vm.runInContext('associatedReceiptId=42', context);

  const sale = context.formData();
  assert.equal(sale.boletaOrigen, '0007-00012303');
  assert.equal(sale.idBoletaOrigen, 42);
  assert.equal(sale.idFacturaAsociada, 0);
  assert.equal(sale.facturaAsociada, '');

  type = 5;
  const credit = context.formData();
  assert.equal(credit.idFacturaAsociada, 42);
  assert.equal(credit.facturaAsociada, '0007-00012303');

  context.syncCustomerTaxShort();
  assert.equal(fields['#customerTaxShort'].textContent, 'CF');
  fields['#customerTax'].value = 'Responsable inscripto';
  context.syncCustomerTaxShort();
  assert.equal(fields['#customerTaxShort'].textContent, 'RI');
});

test('al pasar de una factura cargada a nota de crédito conserva la asociación compatible', async () => {
  const start = html.indexOf('let voucherChangeSequence=0;');
  const end = html.indexOf("$('#customerTax').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  const fields = {
    '#voucherType': { value: '6', addEventListener(event, handler) { this[event] = handler; } },
    '#invoiceReference': { value: '0007-00012303' },
  };
  const context = {
    $: selector => fields[selector],
    SQL_PREPARACION: '/api',
    closeInvoiceOptions() {}, refreshPaymentTypeOptions() {}, markPaymentRuleProblems() {},
    updateTrialButton() {}, scheduleDraft() {}, setMsg() {},
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, factura: { numero: '0007-00012303' } }) }),
  };
  vm.createContext(context);
  vm.runInContext(`let associatedReceiptId=42;${html.slice(start, end)}`, context);
  await fields['#voucherType'].change();
  assert.equal(fields['#invoiceReference'].value, '0007-00012303');
  assert.equal(vm.runInContext('associatedReceiptId', context), 42);

  context.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: 'Factura incompatible' }) });
  await fields['#voucherType'].change();
  assert.equal(fields['#invoiceReference'].value, '0007-00012303');
  assert.equal(vm.runInContext('associatedReceiptId', context), 0);

  vm.runInContext('associatedReceiptId=42', context);
  fields['#voucherType'].value = '13';
  await fields['#voucherType'].change();
  assert.equal(fields['#invoiceReference'].value, '0007-00012303');
  assert.equal(vm.runInContext('associatedReceiptId', context), 42);
});
