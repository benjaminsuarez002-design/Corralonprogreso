const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
test('volver a la ventana conserva cursor; Tab y primer clic mantienen seleccion para editar',()=>{
 const dom=new JSDOM('<form id="purchaseForm"><input id="calculatorIva" data-flow data-purchase-route value="10.000,50"><input id="calculatorNet" data-flow data-purchase-route value="47.621,43"></form>',{runScripts:'outside-only'}),w=dom.window;
 try{w.eval(fs.readFileSync('funciones.js','utf8'));w.FX=w.CorralonFunciones;w.$=id=>w.document.getElementById(id);const html=fs.readFileSync('respaldo/cargar-facturas.html','utf8');const binding=html.match(/FX\.bindLinearNavigation\(\{ root: \$\('purchaseForm'\)[^;]+;/)[0];w.eval(binding);
 const iva=w.$('calculatorIva'),net=w.$('calculatorNet');iva.focus();iva.setSelectionRange(3,3);w.dispatchEvent(new w.Event('blur'));w.dispatchEvent(new w.Event('focus'));iva.dispatchEvent(new w.FocusEvent('focusin',{bubbles:true}));assert.equal(iva.selectionStart,3);assert.equal(iva.selectionEnd,3);
 const tab=new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});iva.dispatchEvent(tab);assert.equal(w.document.activeElement,net);assert.equal(net.selectionStart,0);assert.equal(net.selectionEnd,net.value.length);
 iva.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,cancelable:true}));assert.equal(w.document.activeElement,iva);assert.equal(iva.selectionStart,0);assert.equal(iva.selectionEnd,iva.value.length);
 }finally{dom.window.close()}
});
