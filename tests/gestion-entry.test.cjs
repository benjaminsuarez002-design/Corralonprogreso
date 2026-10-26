const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
test('Gestión es la única entrada del menú para módulos SQL; originales están en respaldo',()=>{
 const menu=new JSDOM(fs.readFileSync('menu.html','utf8')).window.document;
 assert.equal(fs.existsSync('gestion.html'),true);assert.equal(fs.existsSync('facturacion.html'),false);
 const archived=['caja.html','recibos-cobro.html','cargar-facturas.html','cargastock.html','proveedores-sql.html','articulos-sql.html','ventas-tarjeta.html'];
 for(const name of archived){assert.equal(fs.existsSync(name),false);assert.equal(fs.existsSync('respaldo/'+name),true);}
 const links=[...menu.querySelectorAll('a[href^="gestion.html"]')];assert.equal(links.length,1);assert.equal(links[0].querySelector('strong').textContent,'Gestión');
 for(const id of ['caja','recibos_cobro','cargar_facturas','proveedores_sql','ventas_tarjeta','carga_stock','articulos_sql'])assert.equal(menu.querySelector('a[data-menu-id="'+id+'"]'),null);
 const guard=fs.readFileSync('menu-auth-guard.js','utf8');assert.ok(guard.includes("rawFile==='gestion.html'"));assert.equal(guard.includes("rawFile==='facturacion.html'"),false);
});
