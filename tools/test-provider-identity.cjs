// Run: node tools/test-provider-identity.cjs (no network or persistent writes).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'corralon-system.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert(start >= 0, name);
  const firstLineEnd = source.indexOf('\n', start);
  if (source.slice(start, firstLineEnd).trimEnd().endsWith('}')) return source.slice(start, firstLineEnd);
  const end = source.indexOf('\n  }', start);
  return source.slice(start, end + 4);
}
const names = ['norm','cleanId','idVariants','providerInternalId','providerExternalId','newProviderId','resolveProviderText','mergeProviderImport','normalizeProviderPageLink','providerRemotePayload','currentProviderCacheEntries','providerArticleJsonRows','xmlCell','buildArticlesXlsBlob'];
const context = vm.createContext({ crypto: require('node:crypto').webcrypto, Blob, window: {} });
vm.runInContext(source.match(/const PROVIDER_REMOTE_COLUMNS = \[[\s\S]*?\];/)[0] + '\n' + names.map(extract).join('\n') + '\nthis.api = {' + names.join(',') + '};', context);
const api = context.api;
const cables = { id_proveedor: 'internal-cables', codigo_proveedor: '800', proveedor: 'Baud Mol cables', descuento_lista: .2 };
const handles = { id_proveedor: 'internal-handles', codigo_proveedor: '800', proveedor: 'Baud Mol picaportes', descuento_lista: .35 };
const changed = api.normalizeProviderPageLink({ ...cables, codigo_proveedor: '900' });
assert.equal(changed.id_proveedor, cables.id_proveedor);
assert.equal(changed.id_interno, cables.id_proveedor);
assert.equal(api.providerRemotePayload(changed).codigo_proveedor, '900');
assert(!('id_interno' in api.providerRemotePayload(changed)), 'generated column must not be written');
assert.equal(api.resolveProviderText([cables,handles], '800'), null, 'shared codes must not choose an arbitrary list');
assert.equal(api.resolveProviderText([cables,handles], '800 - Baud Mol picaportes'), handles);
const merged = api.mergeProviderImport([cables,handles], [{...cables, id_interno:cables.id_proveedor, codigo_proveedor:'900'}]);
assert.equal(merged.length, 2);
assert.equal(merged.find(p=>p.id_proveedor===handles.id_proveedor).descuento_lista, .35);
assert.equal(merged.find(p=>p.id_proveedor===cables.id_proveedor).codigo_proveedor, '900');
const added = api.mergeProviderImport([cables,handles], [{id_proveedor:'800', proveedor:'Baud Mol herramientas'}]);
assert.equal(added.length,3);
assert.notEqual(added[2].id_proveedor,'800');
assert.equal(added[2].codigo_proveedor,'800');
assert.throws(()=>api.mergeProviderImport([cables], [{id_proveedor:'901',proveedor:cables.proveedor}]), /IDInterno/);
assert.throws(()=>api.mergeProviderImport([], [{id_proveedor:'800',proveedor:'x'},{id_proveedor:'800',proveedor:'x'}]), /repetido/);
assert.throws(()=>api.mergeProviderImport([cables], [{...cables,id_interno:'unknown'}]), /desconocido/);
assert.equal(api.currentProviderCacheEntries([{id_proveedor:'a',proveedor:'same'},{id_proveedor:'b',proveedor:'same'}]).length,2);
const entries=api.currentProviderCacheEntries([{id_proveedor:'old'},{id_proveedor:'new',previous_provider_ids:['old']},{id_proveedor:'other'}]);
assert.equal(entries.length,2);
assert(!entries.some(p=>p.id_proveedor==='old'));
assert.equal(api.providerArticleJsonRows(cables.id_proveedor,[{id_proveedor:'800',articulo:'Cable',precio_costo:20}])[0].id_proveedor,cables.id_proveedor);
async function main(){
  const enrichStart=source.indexOf('    async function enrichIndexProviders(');
  const enrichEnd=source.indexOf('\n    }',enrichStart)+6;
  context.getProvidersCache=async()=>[cables,handles,changed];
  context.withSearch=row=>row;
  vm.runInContext(source.slice(enrichStart,enrichEnd)+'\nthis.enrich=enrichIndexProviders;',context);
  const catalog=await context.enrich([
    {idProveedor:'800',proveedor:'Baud Mol'},
    {idProveedor:'800',proveedor:handles.proveedor},
    {idProveedor:'900',proveedor:''}
  ]);
  assert.equal(catalog[0].idProveedor,'','ambiguous ERP code cannot pick a list');
  assert.equal(catalog[1].idProveedor,handles.id_proveedor);
  assert.equal(catalog[2].idProveedor,cables.id_proveedor);
  assert.equal(catalog[2].codigoProveedorExterno,'900');
  const xml=await api.buildArticlesXlsBlob([{id_proveedor:cables.id_proveedor,articulo:'Cable',precio_costo:20}],changed).text();
  assert(xml.includes('>900</Data>'));
  assert(!xml.includes('internal-cables'));
  const pages=['proveedores.html','actualizar articulos.html','cargastock.html','calculadoras.html','comprobantes.html','faltantes.html','pedidos.html','listasproveedores.html','menu.html','facturacion.html','historial.html','remitos.html'];
  let scripts=0;
  for(const page of pages){
    const html=fs.readFileSync(path.join(root,page),'utf8');
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
      if(/\bsrc\s*=/.test(match[1]) || /type\s*=\s*["']application\//i.test(match[1]))continue;
      // Parse only; do not execute page code or make network writes.
      new vm.Script(match[2].replace(/^\s*import\s[^;]+;/gm,''),{filename:page});
      scripts++;
    }
  }
  console.log(`Identity, shared-code selection, safe import, JSON isolation and ERP export passed; ${scripts} inline scripts parsed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
