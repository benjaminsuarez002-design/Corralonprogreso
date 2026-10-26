const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {JSDOM}=createRequire(path.join(__dirname,'../.codex-staging/importer-dom-test/package.json'))('jsdom');
function fixture(){
 const dom=new JSDOM('<table id="articleTable" class="grid"><tbody id="articleBody"><tr data-row="0">'+['idart','codProv','descripcion'].map((key,col)=>`<td><input data-row="0" data-col="${col}" data-a="${key}"></td>`).join('')+'</tr></tbody></table><table id="paymentTable"><tbody id="paymentBody"></tbody></table><div id="suggestions"></div>',{runScripts:'outside-only'});
 const w=dom.window;
 const invoiceSource=fs.readFileSync(path.join(__dirname,'../gestion.html'),'utf8');
 w.eval(invoiceSource.slice(invoiceSource.indexOf('function invoiceDocumentEvent('),invoiceSource.indexOf("const DB_NAME='corralon_facturacion_v1'")));
 w.eval(fs.readFileSync(path.join(__dirname,'../funciones.js'),'utf8'));
 w.eval(`var articles=[{}],payments=[],renders=0,drafts=0;var $=s=>document.querySelector(s);function renderArticles(){renders++;document.querySelector('#articleBody').innerHTML='';}function renderPayments(){}function renderTotals(){}function scheduleDraft(){drafts++;}function n(v){return Number(v)||0;}function pastePaymentTable(){return false;}`);
 const source=fs.readFileSync(path.join(__dirname,'../gestion.html'),'utf8');
 const start=source.indexOf('function bindTableRules(){'),end=source.indexOf('\n',start);
 w.eval(source.slice(start,end));w.bindTableRules();
 for(const input of w.document.querySelectorAll('#articleBody input'))input.addEventListener('input',()=>{w.document.getElementById('suggestions').classList.add('open');w.activeSuggestionInput=input;});
 return dom;
}
for(const key of ['idart','codProv','descripcion'])test(`pegar ${key} mantiene el campo y su lista abiertos`,()=>{
 const dom=fixture(),w=dom.window,input=w.document.querySelector(`[data-a="${key}"]`);input.focus();
 const event=new w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=>key==='descripcion'?'CEMENTO LOMA NEGRA':'001234'}});input.dispatchEvent(event);
 assert.equal(event.defaultPrevented,true);assert.equal(w.document.activeElement,input);assert.equal(w.activeSuggestionInput,input);assert.equal(input.isConnected,true);assert.equal(w.renders,0);assert.equal(w.articles[0][key],input.value);assert.ok(w.document.getElementById('suggestions').classList.contains('open'));dom.window.close();
});
test('el pegado de varias columnas conserva la actualización de la tabla',()=>{
 const dom=fixture(),w=dom.window,input=w.document.querySelector('[data-a="idart"]');input.focus();
 w.document.getElementById('articleTable')._selectionController.pasteText('001234\tPROV1\tCEMENTO',input);
 assert.equal(w.articles[0].idart,'001234');assert.equal(w.articles[0].codProv,'PROV1');assert.equal(w.articles[0].descripcion,'CEMENTO');assert.equal(w.renders,1);dom.window.close();
});
