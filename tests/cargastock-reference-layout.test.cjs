const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('respaldo/cargastock.html','utf8'),layout=html.match(/<script id="stock-reference-layout">([\s\S]*?)<\/script>/)[1];
test('Carga Stock conserva los campos y llena la pantalla con su diseño compartido',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;
 try{w.eval(layout);
  for(const id of ['stockIngresoSucursal','stockTipoMovimiento','stockNumero','stockFecha','stockOperador','stockDestino','stockRelacionado','providerInput','stockArticleFilter','stockIngresoFactura','stockCompra','stockRemito','stockCostOptions','rows','stockIngresoNota','stockTotalUnits','stockTotalAmount','compareStockBtn','copyBtn','stockConsultBtn','stockCancelBtn','stockNewBtn','stockPrevBtn','stockNextBtn','stockPrintBtn','confirmStockIngresoBtn'])assert.equal(w.document.querySelectorAll('#'+id).length,1,id);
  assert.ok(w.document.querySelector('link[href^="theme-corralon.css"]'));
  for(const [width,height] of [[1280,720],[1366,768],[1536,1024],[1920,1080],[2560,1440]]){
   Object.defineProperty(w,'innerWidth',{value:width,configurable:true});Object.defineProperty(w,'innerHeight',{value:height,configurable:true});w.dispatchEvent(new w.Event('resize'));
   const app=w.document.querySelector('.app'),scale=Number(app.style.getPropertyValue('--stock-reference-scale'));
   assert.ok(Math.abs(parseFloat(app.style.getPropertyValue('--stock-reference-width'))*scale-width)<.001);
   assert.ok(Math.abs(parseFloat(app.style.getPropertyValue('--stock-reference-height'))*scale-height)<.001);
  }
 }finally{w.close();}
});
