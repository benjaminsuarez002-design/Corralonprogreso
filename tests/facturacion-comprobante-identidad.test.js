const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','gestion.html'),'utf8');
const from=html.indexOf('function assertReceiptMatches(');
const to=html.indexOf('async function verifyRecovery(',from);
const ctx=vm.createContext({});
vm.runInContext(html.slice(from,to),ctx);
function fixtures(){
  const data={idComprobante:13,idPuntoVenta:4,idCliente:1,fecha:'2026-10-02',cliente:{nombre:'FERNANDEZ'},totales:{total:7300},articulos:[{idart:'000840',descripcion:'ANTEOJO',cantidad:1,precio:2300},{idart:'002046',descripcion:'SOGA',cantidad:5,precio:998.52}],valores:[{idTipoPago:3,idTarjeta:10,cuotas:0,importe:7292.6,impRec:7.4}]};
  const result={comprobante:{confirmado:-1,anulada:0,idComprobante:13,idPuntoVenta:4,idCliente:1,fechaComprobante:'2026-10-02',cliente:'FERNANDEZ',numero:'0004-00038190',totalAbsoluto:7300},articulos:structuredClone(data.articulos),valores:structuredClone(data.valores)};
  return {data,result};
}
test('permite imprimir una copia coincidente con SQL',()=>{const {data,result}=fixtures();ctx.assertReceiptMatches(data,result,{numero:result.comprobante.numero});});
for(const [label,change] of [
  ['venta de PAGAN por 28000',r=>{r.comprobante.cliente='PAGAN';r.comprobante.totalAbsoluto=28000;}],
  ['artículo diferente con igual total y cantidad de filas',r=>r.articulos[0].idart='010058'],
  ['cantidad diferente',r=>r.articulos[0].cantidad=2],
  ['precio diferente',r=>r.articulos[0].precio=2200],
  ['fecha diferente',r=>r.comprobante.fechaComprobante='2026-10-01'],
  ['cliente diferente',r=>r.comprobante.cliente='PAGAN'],
  ['punto diferente',r=>r.comprobante.idPuntoVenta=7],
  ['medio de pago diferente',r=>r.valores[0].idTipoPago=1],
  ['importe no disponible',r=>delete r.comprobante.totalAbsoluto],
  ['anulada',r=>r.comprobante.anulada=-1],
])test(`bloquea ${label} sin modificar la copia`,()=>{const {data,result}=fixtures(),before=structuredClone(data);change(result);assert.throws(()=>ctx.assertReceiptMatches(data,result),/no coincide/);assert.deepEqual(data,before);});
test('bloquea un número distinto aunque el contenido coincida',()=>{const {data,result}=fixtures();assert.throws(()=>ctx.assertReceiptMatches(data,result,{numero:'0004-00038134'}),/no coincide/);});
test('todos los caminos validan el contenido antes de asociar o imprimir',()=>{
  assert.ok(html.includes('assertReceiptMatches(formData(),receipt,{numero:state.numero});'));
  assert.ok(html.includes('assertReceiptMatches(draft,receipt);'));
  assert.ok(html.includes('assertReceiptMatches(data,check,{numero:payload.numero});'));
  assert.ok(html.includes('assertReceiptMatches(data,result,receipt);'));
});
test('sintaxis de scripts de facturación',()=>{for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!m[1].includes('src=')&&!m[1].includes('type="module"'))new vm.Script(m[2]);});
