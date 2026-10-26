const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('respaldo/cargastock.html','utf8');
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/type\s*=\s*["']module/.test(m[1]))new vm.Script(m[2]);
assert(html.indexOf('CORRALON_DISABLE_CATALOG_REALTIME = true')<html.indexOf('src="corralon-system.js'));
assert(!/loadIndexCodes|repairUnmatchedIndexRows|catalog\?*\.|faltantes\?*\.|corralon:catalog-/.test(html));
const codeKey=v=>String(v||'').trim().toUpperCase();
const ctx={provider:{id_proveedor:1},stockSqlMeta:{},stockSqlArticles:[
  {idart:'000010',codProv:'A',proveedor:1,descripcion:'Articulo uno',idRubro:3,rubroNombre:'Rubro',precioCosto:10},
  {idart:'000020',codProv:'A',proveedor:2,descripcion:'Articulo dos',idRubro:3,rubroNombre:'Rubro',precioCosto:20}
],providers:[{id_proveedor:1,proveedor:'UNO'}],codeKey,norm:v=>String(v).toUpperCase(),providerLabel:p=>p.proveedor,
  stockProviderId:()=>1,stockField:()=>({checked:true}),closeArticleProviderList(){},
  CorralonSystem:{providerIdentity:{externalId:p=>p.id_proveedor},articleOptionPager:{prepare:rows=>rows}},
  stockMatchesForRow:r=>ctx.stockSqlArticles.filter(a=>a.codProv===r.codigo&&a.proveedor===1)};
const catalog=html.slice(html.indexOf('function stockRebuildSqlCatalog'),html.indexOf('function editableCellPosition'));
const options=html.slice(html.indexOf('function stockRebuildArticleOptions'),html.indexOf('async function stockRefreshSql'));
const green=html.slice(html.indexOf('function isGreen(row)'),html.indexOf('function stockCostOptionsActive'));
vm.runInNewContext(catalog+options+green,ctx);ctx.stockRebuildSqlCatalog();ctx.stockRebuildArticleOptions();
assert.equal(ctx.stockSqlCatalogRows[0].codigo,'000010');assert.equal(ctx.stockSqlCatalogRows[0].id_rubro,3);assert.equal(ctx.stockSqlCodeMatchCounts.get('A'),2);
assert.equal(ctx.providerArticles.length,1);assert.equal(ctx.providerArticles[0].idart,'000010');
assert(ctx.isGreen({codigo:'A',idart:'000010'}));assert(!ctx.isGreen({codigo:'A',idart:'000020'}));
ctx.stockField=()=>({checked:false});ctx.stockRebuildArticleOptions();assert.equal(ctx.providerArticles.length,2);
const shared=fs.readFileSync('corralon-system.js','utf8');new vm.Script(shared);
assert(shared.includes("options.catalogSource === 'sql' && !catalog"));assert(shared.includes("options.catalogSource !== 'sql' && rubros(catalog).length <= 1"));
console.log('PASS: inicio sin Index/realtime; lista SQL completa o por proveedor; ID/proveedor validados; importador sin fallback Index');
