import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../respaldo/cargastock.html', import.meta.url), 'utf8');
const start = html.indexOf('function parseStockClipboardTable(text) {');
const end = html.indexOf('function isBlankStockRow(row = {}) {', start);
assert.ok(start >= 0 && end > start, 'se encontró el parser de Cargar Stock');
const parsePasted = Function('FX', 'norm', 'moneyNumber', 'parsePercent', 'normalizeRow', 'providerDiscountValue',
  `${html.slice(start, end)}; return parsePasted;`)(
  {},
  value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(),
  value => Number(String(value ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0,
  value => (Number(String(value ?? '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0) / 100,
  row => row,
  () => 0
);

const rows = parsePasted('19702\tDILUYENTE AGUARRAS\t48\t4842,50\t35%\n20191\tENDUIDO PLASTICO\t2\t49997,43\t45%\n17099\tIMPERMEABILIZANTE TECHOS\t12\t8314,50\t38%');
assert.deepEqual(rows.map(row => row.descuentoAdicional), [.35, .45, .38]);
assert.deepEqual(rows.map(row => row.precio), [4842.5, 49997.43, 8314.5]);
const withHeader = parsePasted('Código\tDescripción\tCantidad\tPrecio\n123\tPrueba\t1\t100,00');
assert.equal(withHeader[0].descuentoAdicional, 0);
console.log('PASS descuentos de la quinta columna sin encabezado');
const sample = '1302201\tDISCOS DE CORTE SIN PAR 115 X 0.80 X 22.2 MM (100)\t100\t650,00\t25,85 \n2600201\tFLOTANTE P/TANQUE VARILLA LARGA BRONCE 1/2" (50)\t6\t16920,00\t25,85 \n3301006\tARANDELA PLASTICA DE 1/2 X 100 U (ARP02)(10209) (1000)\t1\t4578,37\t25,85 ';
const actual = parsePasted(sample);
assert.equal(actual.length, 3);
assert.deepEqual(actual.map(row=>row.precio), [650,16920,4578.37]);
assert.ok(actual.every(row=>row.descuentoAdicional===.2585));
assert.equal(actual[1].codigo,'2600201');
const listenerStart=html.indexOf("document.addEventListener('paste', (event) => {",html.indexOf('el.corner.tabIndex = 0;'));
const listenerEnd=html.indexOf('}, true);',listenerStart)+10;
let listener,pasted,prevented=false;
Function('document','el','stockConfirmed','stockIngresoBusy','pasteAllText',html.slice(listenerStart,listenerEnd))(
  {addEventListener:(_name,callback)=>{listener=callback;},getElementById:()=>({classList:{contains:()=>false}})},
  {corner:{classList:{contains:()=>true}}},false,false,text=>{pasted=text;}
);
listener({defaultPrevented:false,target:{closest:()=>null},clipboardData:{getData:()=>sample},preventDefault(){prevented=true;},stopImmediatePropagation(){}});
assert.equal(pasted,sample);assert.ok(prevented);
console.log('PASS native Ctrl+V on table corner without Clipboard API or HTTPS');
const {createRequire}=await import('node:module');
const require=createRequire(new URL('../.codex-staging/importer-dom-test/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<button id="origin">Pegar</button>',{runScripts:'outside-only',url:'http://192.168.100.28:8080/cargastock.html'}),w=dom.window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
w.eval(await readFile(new URL('../funciones.js',import.meta.url),'utf8'));
w.document.getElementById('origin').focus();
const request=w.CorralonFunciones.requestClipboardText();
assert.equal(request,w.CorralonFunciones.requestClipboardText(),'repeated actions reuse one dialog');
const pasteEvent=new w.Event('paste',{bubbles:true,cancelable:true});
Object.defineProperty(pasteEvent,'clipboardData',{value:{getData:()=>sample}});
w.document.querySelector('dialog textarea').dispatchEvent(pasteEvent);
assert.equal(await request,sample);
assert.equal(w.document.querySelector('dialog'),null);
assert.equal(w.document.activeElement.id,'origin');
const canceled=w.CorralonFunciones.requestClipboardText();
w.document.querySelector('[data-cancel]').click();assert.equal(await canceled,null);
Object.defineProperty(w.navigator,'clipboard',{value:{readText:async()=>sample}});
assert.equal(await w.CorralonFunciones.requestClipboardText(),sample);
assert.equal(w.document.querySelector('dialog'),null);
console.log('PASS HTTP paste dialog, native clipboard contents, cancellation, repeated actions and secure clipboard path');
