import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {loadArticlePager} from './local-article-pager.mjs';
const pager=await loadArticlePager();
for(const file of ['cargastock.html','local-article-importer.js']){
 const text=fs.readFileSync(file,'utf8'),helper=text.slice(text.indexOf('const normalizeIndexFilter ='),text.indexOf('const escape =',text.indexOf('const normalizeIndexFilter =')));
 const start=text.indexOf('  function search(input, row) {'),body=text.slice(start,text.indexOf('    menu = document.createElement',start))+'return articlePage.options.slice(articlePage.focusIndex);\n}';
 test(`${file}: pico j prioriza PICO incluso frente a coincidencia exacta de codigo proveedor`,()=>{
  const ctx=vm.createContext({hideMenu(){},normalize:v=>String(v||'').toUpperCase().trim(),window:{CorralonSystem:{articleOptionPager:pager}},descriptionMatchesOnly:()=>true,Map,Number});vm.runInContext(helper,ctx);ctx.normalizeIndexFilter=vm.runInContext("normalizeIndexFilter",ctx);ctx.compactIndexFilter=vm.runInContext("compactIndexFilter",ctx);
  ctx.catalogSorted=[{id:'1',codigo:'07',descripcion:'GRIF. DAROS MONOC. MESADA PICO J CROM.'},{id:'2',codigo:'02',descripcion:'PICO J CROMADO'},{id:'3',codigo:'03',descripcion:'PICO MOVIL J'},{id:'4',codigo:'04',descripcion:'DIAFRAGMA PARA CALEFON'},{id:'5',codigo:'05',descripcion:'CALEFON PLASTICO'}].map(a=>({...a,searchCode:a.codigo,searchDescription:ctx.normalizeIndexFilter(a.descripcion),searchCompact:ctx.compactIndexFilter(a.descripcion),searchWords:ctx.normalizeIndexFilter(a.descripcion).split(' ')}));
  vm.runInContext(body,ctx);ctx.input={value:'pico j'};ctx.row={codigo:'07'};const result=vm.runInContext('search(input,row)',ctx);assert.deepEqual(Array.from(result.slice(0,3),a=>a.id),['2','3','1']);
  ctx.input.value='calefon';ctx.row.codigo='';const next=vm.runInContext('search(input,row)',ctx);assert.equal(next[0].id,'5');assert.equal(next[1].id,'4');
 });
}

