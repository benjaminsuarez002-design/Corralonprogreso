const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('respaldo/cargar-facturas.html','utf8');
const layout=html.match(/<script id="purchase-entry-layout">([\s\S]*?)<\/script>/)[1];
test('Cargar facturas conserva controles y acciones al escalar su nueva distribución',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;
 try{
  w.eval(layout);
  for(const id of ['type','number','date','provider','providerName','cuit','period','due','goods','account','payment','concept','quickTotal','remito','total','lastNumber','note','movement','inStock','discount','discountAmount','discountTotal','searchNumber','confirm','cancel','consult','point','taxRows','addRow'])assert.equal(w.document.querySelectorAll('#'+id).length,1,id);
  assert.ok(w.document.getElementById('searchNumber').closest('.purchase-actions'));
  assert.equal(w.document.getElementById('searchNumber').closest('fieldset'),null);
  let searches=0;w.document.getElementById('purchaseFields').disabled=false;w.document.getElementById('search').disabled=false;
  w.document.getElementById('search').addEventListener('click',()=>searches++);
  w.document.getElementById('entrySearchButton').click();assert.equal(searches,1);
  for(const [width,height] of [[1280,720],[1366,768],[1536,1024],[1920,1080],[2560,1440]]){
   Object.defineProperty(w,'innerWidth',{value:width,configurable:true});Object.defineProperty(w,'innerHeight',{value:height,configurable:true});w.dispatchEvent(new w.Event('resize'));
   const scale=Number(w.document.querySelector('.app').style.getPropertyValue('--purchase-entry-scale'));
   assert.equal(scale,Math.min(1,width/(2*1536),(height-74)/950)*1.4);assert.ok((1070+19/1.4)*scale<=width/2);
  }
 }finally{w.close();}
});
test('el script de funcionamiento sigue siendo sintácticamente válido',()=>{new vm.Script(html.match(/<script id="cargar-facturas-script">([\s\S]*?)<\/script>/)[1]);});
