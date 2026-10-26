const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'pedidos.html'), 'utf8');
function take(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const end = source.indexOf('\nfunction ', start + 10);
  return source.slice(start, end < 0 ? source.length : end);
}

const context = vm.createContext({ JSON });
vm.runInContext(
  ['cloneRow', 'statesEqual', 'createFieldMovement'].map(take).join('\n') +
  '\nthis.createFieldMovement=createFieldMovement',
  context
);

const row = (uid, code, description) => ({
  localUid: uid,
  codProv: code,
  articulo: description,
  cantidad: 1,
  precioSiva: 100,
  precioCiva: 121,
  subtotal: 121
});
const snapshot = (value, col, rowIndex = 0) => ({
  rowUid: value.localUid,
  rowIndex,
  col,
  row: structuredClone(value),
  pending: false
});

const initialCode = row('fila-a', '9', 'ARTICULO A');
const code10 = row('fila-a', '10', 'ARTICULO A');
const descriptionBefore = row('fila-b', '20', 'DESCRIPCION VIEJA');
const descriptionAfter = row('fila-b', '20', 'DESCRIPCION NUEVA');
const code11 = row('fila-a', '11', 'ARTICULO A');

const undoStack = [
  context.createFieldMovement(snapshot(initialCode, 1), code10, 1),
  context.createFieldMovement(snapshot(descriptionBefore, 3, 1), descriptionAfter, 2),
  context.createFieldMovement(snapshot(code10, 1), code11, 3)
];
assert.deepEqual(undoStack.map(item => item.idMov), [1, 2, 3]);
assert.equal(context.createFieldMovement(snapshot(code11, 1), code11, 4), null, 'focus without changes is not a movement');

const current = new Map([
  ['fila-a', code11],
  ['fila-b', descriptionAfter]
]);
const undo = () => {
  const movement = undoStack.pop();
  current.set(movement.rowUid, structuredClone(movement.before));
  return movement;
};

assert.equal(undo().idMov, 3);
assert.equal(current.get('fila-a').codProv, '10');
assert.equal(undo().idMov, 2);
assert.equal(current.get('fila-b').articulo, 'DESCRIPCION VIEJA');
assert.equal(undo().idMov, 1);
assert.equal(current.get('fila-a').codProv, '9');

console.log('Pedidos: Ctrl+Z por campo y movimientos repetidos en orden verificados.');
