const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {JSDOM}=createRequire(path.join(__dirname,'../.codex-staging/importer-dom-test/package.json'))('jsdom');
function fixture(){
 const dom=new JSDOM('<input id="date" inputmode="numeric"><input id="voucher" inputmode="numeric"><input id="quantity" type="number"><div id="article"><input id="price" data-number-format="money" value="100,00"><input id="stock" inputmode="decimal"></div>',{runScripts:'outside-only'});
 dom.window.eval(fs.readFileSync(path.join(__dirname,'../funciones.js'),'utf8'));
 return dom;
}
function edit(dom,id,value){
 const input=dom.window.document.getElementById(id);input.focus();input.value=value;
 input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 input.blur();return input;
}
test('cargar funciones compartidas no activa cuentas en fechas, comprobantes ni cantidades',()=>{
 const dom=fixture();
 for(const [id,value] of [['date','01-09-26'],['voucher','0006-00045448'],['quantity','12']]){
  const input=edit(dom,id,value);assert.equal(input.value,value);assert.equal(input.validationMessage,'');
 }
 const quantity=dom.window.document.getElementById('quantity');quantity.focus();quantity.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'*',bubbles:true}));assert.equal(quantity.type,'number');
 dom.window.close();
});
test('la activación explícita de Artículos afecta únicamente los campos de precio',()=>{
 const dom=fixture();
 dom.window.CorralonFunciones.bindNumericExpressions({root:dom.window.document.getElementById('article'),selector:'input[data-number-format="money"]'});
 const price=edit(dom,'price','+3%');assert.equal(price.value,'103,00');assert.equal(price.validationMessage,'');
 const date=edit(dom,'date','01-09-26');assert.equal(date.value,'01-09-26');assert.equal(date.validationMessage,'');
 const stock=edit(dom,'stock','5-2');assert.equal(stock.value,'5-2');assert.equal(stock.validationMessage,'');
 dom.window.close();
});
