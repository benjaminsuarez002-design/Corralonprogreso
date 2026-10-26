import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {loadArticlePager} from './local-article-pager.mjs';
const html=fs.readFileSync(new URL('../respaldo/cargastock.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function filteredProviderArticles(cell) {'),html.indexOf('function renderArticleProviderList()'));
const pager=await loadArticlePager();
function search(query,field='descripcion',code='3116',filtered=true){
 const rows=[{idart:'003330',codProv:'3301002',descripcion:'ARANDELA DE FIBRA PARA CALEFON'}, {idart:'007484',codProv:'90',descripcion:'CALEFON A LEÑA 90LTS'}, {idart:'010897',codProv:'3116',descripcion:'CALEFON PLASTICO 25LTS'}, {idart:'008502',codProv:'dia',descripcion:'DIAFRAGMA PARA CALEFON'}, {idart:'007483',codProv:'125',descripcion:'CALEFON A LEÑA 125LTS'}, {idart:'004000',codProv:'cf',descripcion:'CALEFONES ELECTRICOS'}, {idart:'000001',codProv:'a',descripcion:'ABRAZADERA'}];
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const ctx=vm.createContext({rowsData:[{codigo:code}],providerArticlesOrdered:rows,providerArticleSearch:new WeakMap(),norm,codeKey:v=>String(v||'').toUpperCase(),stockSqlArticles:rows,stockCostOptionsActive:()=>false,stockMatchesForRow:()=>[],stockUsesProviderList:()=>false,stockDescriptionMatchesOnly:()=>filtered,stockField:()=>({value:'sql'}),CorralonSystem:{articleOptionPager:pager},cell:{dataset:{row:'0',field},textContent:query}});
 vm.runInContext(source,ctx);return vm.runInContext('filteredProviderArticles(cell).slice(articleProviderPage.focusIndex)',ctx);
}
test('calefon prioriza primera palabra y mantiene coincidencias de accesorios despues',()=>{
 const result=search('calefon');assert.deepEqual(Array.from(result.slice(0,3),r=>r.idart),['010897','007484','007483']);const names=Array.from(result,r=>r.descripcion);assert.ok(names.indexOf('CALEFONES ELECTRICOS')<names.indexOf('ARANDELA DE FIBRA PARA CALEFON'));assert.ok(names.indexOf('ARANDELA DE FIBRA PARA CALEFON')<names.indexOf('DIAFRAGMA PARA CALEFON'));
});
test('tambien ordena al mostrar lista completa, sin perder contexto ni codigo exacto por ID',()=>{
 assert.equal(search('calefon','descripcion','3301002',false)[0].descripcion.startsWith('CALEFON '),true);assert.equal(search('003330','idart')[0].idart,'003330');assert.equal(search('calefon leña')[0].descripcion.startsWith('CALEFON A LEÑA'),true);
});

