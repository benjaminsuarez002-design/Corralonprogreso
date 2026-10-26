const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
test('popup de ficha consulta sólo catálogos y el artículo elegido, sin descargar el listado',async()=>{
 const dom=new JSDOM(fs.readFileSync('respaldo/articulos-sql.html','utf8'),{url:'http://localhost/articulos-sql.html?embed=stock&ficha=1',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()}),w=dom.window,calls=[];
 w.structuredClone=structuredClone;w.CSS={escape:v=>v};w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.eval(fs.readFileSync('funciones.js','utf8'));
 w.fetch=async url=>{const query=new URL(url,'http://localhost').searchParams;calls.push(query);return {ok:true,json:async()=>query.get('catalogos')==='1'?{ok:true,proveedores:[],rubros:[],secciones:[],monedas:[],tasasIva:[]}:{ok:true,articulo:{id:query.get('id'),descripcion:'Prueba',idIva:1},stock:[]}};};
 try{
 w.eval(fs.readFileSync('articulos-sql.js','utf8'));await w.CorralonSQLArticleEditor.open('006766');
 assert.equal(w.document.getElementById('articleDialog').open,true);assert.equal(calls.length,2);assert.equal(calls[0].get('catalogos'),'1');assert.equal(calls[1].get('id'),'006766');
 assert.equal(w.document.getElementById('articlePosition').textContent,'1 / 1');
 await w.CorralonSQLArticleEditor.open('000001');assert.equal(calls.length,3);assert.equal(calls[2].get('id'),'000001');assert.equal(calls.some(query=>!query.has('id')&&!query.has('catalogos')),false);
 }finally{w.close();}
});
