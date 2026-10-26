const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','gestion.html'),'utf8');
const start=html.indexOf('function decimalParts(');
const end=html.indexOf('function newDraftId(',start);
assert.ok(start>=0&&end>start,'No se encontró el cálculo de precios de Facturación');
const context=vm.createContext({n:value=>Number(value)||0});
vm.runInContext(html.slice(start,end),context);

test('precio, descuento y margen se calculan desde la misma base',()=>{
  const row={precioBase:10000,precio:10000,costoFinal:5000,descuento:0,margen:100};
  row.precio=9000;
  context.recalculateArticle(row,'precio');
  assert.equal(row.descuento,10);
  assert.equal(row.margen,80);

  row.descuento=8;
  context.recalculateArticle(row,'descuento');
  assert.equal(row.precio,9200);
  assert.equal(row.margen,84);

  row.margen=90;
  context.recalculateArticle(row,'margen');
  assert.equal(row.precio,9500);
  assert.equal(row.descuento,5);
});

test('subir el precio conserva el original y marca descuento negativo',()=>{
  const row={precioBase:10000,precio:11000,costoFinal:5000,descuento:0};
  context.recalculateArticle(row,'precio');
  assert.equal(row.precioBase,10000);
  assert.ok(Math.abs(row.descuento+10)<.001);
  assert.ok(Math.abs(row.margen-120)<.001);
});

test('el margen usa costo y precio convertidos a pesos',()=>{
  const row={precioBase:4379,precio:4379,costoFinal:2.0702*1510,descuento:0};
  assert.equal(context.articleMargin(row),40.08);
});

test('un borrador viejo en moneda extranjera exige volver a elegir el artículo',()=>{
  const row={idart:'000006',precio:2.9,precioBase:2.9};
  let warning='';
  context.articles=[row];
  context.catalog=[{idart:'000006',costoFinal:3126.002,idMoneda:4,cotizacion:1510}];
  context.setMsg=message=>{warning=message};
  context.syncArticleCosts();
  assert.equal(row.cotizacion,undefined);
  assert.match(warning,/Volvé a seleccionarlos/);
});
