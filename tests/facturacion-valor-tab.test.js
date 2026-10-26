const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
const from = html.indexOf('function bindPaymentGridNavigation(){');
const to = html.indexOf('function bindFunctions(){', from);
assert.ok(from >= 0 && to > from);

test('Tab confirma la opción abierta antes de navegar en tipo de valor y tarjeta', () => {
  const handlers = new Map();
  const table = { addEventListener(type, handler, capture) { if (type === 'keydown') handlers.set(capture, handler); } };
  const menu = { classList: { contains: name => name === 'open' } };
  const selections = [];
  const context = {
    $: selector => selector === '#paymentTable' ? table : menu,
    paymentComboOptions: [{ nombre: 'Mercado Pago' }],
    paymentComboNavigated: false,
    paymentComboHasMatch: true,
    paymentComboAnchor: 0,
    paymentComboActive: -1,
    pickPaymentOption: (index, advance) => selections.push({ index, advance }),
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  context.bindPaymentGridNavigation();
  const handler = handlers.get(true);
  assert.equal(typeof handler, 'function');

  for (const col of ['0', '2']) {
    const cell = { dataset: { row: '0', col } };
    context.paymentComboInput = cell;
    let prevented = false, stopped = false;
    handler({
      key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false,
      target: { closest: () => cell },
      preventDefault() { prevented = true; },
      stopImmediatePropagation() { stopped = true; },
    });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  }
  assert.deepEqual(selections, [{ index: 0, advance: true }, { index: 0, advance: true }]);
});
