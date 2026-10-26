import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../.codex-staging/importer-dom-test/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const source=await readFile(new URL('../corralon-system.js',import.meta.url),'utf8');
const start=source.indexOf('  const WEB_VERSION_NOTIFIER = (() => {');
const end=source.indexOf('\n  window.CorralonSystem =',start);
function setup(url,embedded=false,key='articulos-sql'){
  const dom=new JSDOM('<script src="corralon-system.js"></script><body></body>',{url});
  let version='1.0.11',reads=0;
  const window={self:{},top:{},addEventListener(){}};if(!embedded)window.top=window.self;
  const listeners=[];
  const context=vm.createContext({window,document:dom.window.document,location:dom.window.location,URL,localStorage:dom.window.localStorage,requestAnimationFrame:fn=>fn(),setInterval(){assert.fail('No debe iniciar sondeo paralelo')},mockApp:{getApps:()=>[],initializeApp:()=>({})},mockFire:{getFirestore:()=>({}),doc:()=>({}),onSnapshot:(ref,next)=>{listeners.push(next);return()=>{}}},fetch:async()=>{reads++;return{ok:true,json:async()=>({paginas:{[key]:{version,ultimo_cambio:'Cambio'}}})};}});
  const code=source.slice(start,end).replace(/import\('https:\/\/[^']*firebase-app.js'\)/g,'Promise.resolve(mockApp)').replace(/import\('https:\/\/[^']*firebase-firestore.js'\)/g,'Promise.resolve(mockFire)');
  vm.runInContext(code+';globalThis.notifier=WEB_VERSION_NOTIFIER;',context);
  return{notifier:context.notifier,document:dom.window.document,setVersion:v=>{version=v;},reads:()=>reads,listeners};
}
const embed=setup('http://localhost:8080/articulos-sql.html?embed=stock',true);
embed.notifier.start();assert.equal(embed.reads(),0);
const page=setup('http://localhost:8080/articulos-sql.html');
await page.notifier.check();assert.equal(page.document.getElementById('corralon-version-toast'),null);
page.setVersion('1.0.12');await page.notifier.check();assert.ok(page.document.getElementById('corralon-version-toast'));
const refreshed=setup('http://localhost:8080/articulos-sql.html?_version=1.0.11');
await refreshed.notifier.check();assert.equal(refreshed.document.getElementById('corralon-version-toast'),null);
const gestion=setup('http://localhost:8080/gestion.html#caja/diaria',false,'facturacion');
assert.equal(gestion.notifier.pageKey(),'facturacion');
await gestion.notifier.check();assert.equal(gestion.document.getElementById('corralon-version-toast'),null);
gestion.setVersion('1.0.12');await gestion.notifier.check();assert.ok(gestion.document.getElementById('corralon-version-toast'));
const pedidos=setup('http://localhost:8080/pedidos.html?_version=1.0.47',false,'pedidos');
pedidos.notifier.start();await new Promise(resolve=>setImmediate(resolve));assert.equal(pedidos.listeners.length,1);
const event={exists:()=>true,data:()=>({paginas:{pedidos:{version:'1.0.48',ultimo_cambio:'Corrección'}}})};
pedidos.listeners[0](event);await new Promise(resolve=>setImmediate(resolve));assert.ok(pedidos.document.getElementById('corralon-version-toast'));assert.equal(pedidos.reads(),0);
pedidos.listeners[0](event);await new Promise(resolve=>setImmediate(resolve));assert.equal(pedidos.reads(),0);assert.equal(pedidos.document.querySelectorAll('#corralon-version-toast').length,1);
const manifest=JSON.parse(await readFile(new URL('../version-web.json',import.meta.url),'utf8'));
for(const [key]of Object.entries(manifest.paginas)){
 const file=key==='facturacion'?'gestion.html':key==='actualizar-articulos'?'actualizar articulos.html':key==='garantias'?'garantías.html':key+'.html';
 let content;try{content=await readFile(new URL('../'+file,import.meta.url),'utf8')}catch{continue}
 assert.match(content,/src=["'][^"']*corralon-system\.js(?:\?[^"']*)?["']/,'Aviso ausente: '+file);
 const page=setup('http://localhost:8080/'+encodeURIComponent(file)+'?_version=1.0.10',false,key);await page.notifier.check({paginas:{[key]:{version:'1.0.11'}}});assert.ok(page.document.getElementById('corralon-version-toast'),'Aviso no funciona: '+file);
}
console.log('PASS páginas registradas, Gestión, Pedidos realtime sin sondeo ni consultas GitHub duplicadas');
