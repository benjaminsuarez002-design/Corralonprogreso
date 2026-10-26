const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const source=fs.readFileSync('respaldo/cargar-facturas.html','utf8');
function setup(){
 const dom=new JSDOM('<form id="purchaseForm">'+['type','number','date','provider','account','payment','quickTotal','calculatorIva'].map(id=>`<input id="${id}">`).join('')+'<table><tbody id="taxRows"><tr data-row="r">'+['impuesto','neto','importe','porcentaje'].map(field=>`<td><input data-field="${field}" value="1"></td>`).join('')+'</tr></tbody></table><input id="discount"><button id="confirm" type="button">Confirmar</button></form>',{runScripts:'outside-only'}),w=dom.window;
 w.$=id=>w.document.getElementById(id);w.rows=[{key:'r',empty:false}];w.hidePurchaseCombo=()=>{};
 w.currencyNumber=v=>Number(String(v).replace(/\./g,'').replace(',','.'))||0;
 w.eval(source.slice(source.indexOf('  function purchaseRouteControls()'),source.indexOf("  FX.bindLinearNavigation({ root: $('purchaseForm')")));
 const key=(input,key,shift=false)=>{input.focus();input.dispatchEvent(new w.KeyboardEvent('keydown',{key,shiftKey:shift,bubbles:true,cancelable:true}));return w.document.activeElement;};
 return {dom,w,key};
}
for(const keyName of ['Tab','Enter'])test(keyName+' recorre sólo campos marcados y salta impuestos con total cargado',()=>{
 const s=setup();try{
 s.w.$('quickTotal').value='10.000,00';s.w.$('quickTotal').dispatchEvent(new s.w.Event('input'));
 const ids=['type','number','date','provider','account','payment','quickTotal','discount','confirm'];
 for(let i=0;i<ids.length-1;i++)assert.equal(s.key(s.w.$(ids[i]),keyName).id,ids[i+1]);
 assert.equal(s.key(s.w.$('discount'),keyName,true).id,'quickTotal');
 for(const id of ['calculatorIva']){assert.equal(s.w.$(id).tabIndex,-1);assert.equal(s.w.$(id).disabled,false);s.w.$(id).focus();assert.equal(s.w.document.activeElement,s.w.$(id));}
 }finally{s.dom.window.close()}
});
for(const keyName of ['Tab','Enter'])test(keyName+' pasa por los campos de impuestos si total está vacío',()=>{
 const s=setup();try{
 const taxes=[...s.w.$('taxRows').querySelectorAll('input')];assert.equal(s.key(s.w.$('quickTotal'),keyName),taxes[0]);
 for(let i=0;i<taxes.length-1;i++)assert.equal(s.key(taxes[i],keyName),taxes[i+1]);
 assert.equal(s.key(taxes.at(-1),keyName).id,'discount');
 s.w.rows[0].empty=true;taxes[0].value='';assert.equal(s.key(taxes[0],keyName).id,'discount');
 }finally{s.dom.window.close()}
});
test('scripts del HTML conservan sintaxis válida',()=>{for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!match[1].includes('src='))new vm.Script(match[2]);}});
