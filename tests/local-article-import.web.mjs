import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {loadArticlePager} from './local-article-pager.mjs';
import vm from 'node:vm';
const require=createRequire(new URL('../.codex-staging/importer-dom-test/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<body></body>',{url:'http://localhost:8080/cargastock.html'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,innerWidth:1440,innerHeight:900,requestAnimationFrame:fn=>fn()});
window.HTMLElement.prototype.scrollIntoView=()=>{};
window.confirm=()=>true;
let editor, calls=[], fail=true;
let uploadsActive=0,uploadsPeak=0;
let lastProgress;
let rejectPublishToken=false;
const draftCache=new Map();
const originalSet=window.Storage.prototype.setItem;
window.Storage.prototype.setItem=function(key,value){
  if(String(value).length>1024)throw new window.DOMException('localStorage lleno','QuotaExceededError');
  return originalSet.call(this,key,value);
};
window.CorralonSystem={localCache:{async read(key){return structuredClone(draftCache.get(key)||null);},async write(key,value){draftCache.set(key,structuredClone(value));},async remove(key){draftCache.delete(key);}},articleOptionPager:await loadArticlePager(),articleEditor:{open(code,options){editor=options;return true;},async publishImages(article,id,onImage){if(!article.fotoUrl.startsWith('data:'))return article;calls.push({url:'upload-photo',id});uploadsPeak=Math.max(uploadsPeak,++uploadsActive);await new Promise(resolve=>setTimeout(resolve,5));article.fotoUrl=article.imagenes[0]='https://example.com/foto.jpg';uploadsActive--;await onImage(article);return article;}}};
globalThis.fetch=async(url,options={})=>{
  calls.push({url,body:options.body&&JSON.parse(options.body)});
  let data;
  if(url.endsWith('/catalog'))data={token:'local',articles:[],rubros:[{id:1,nombre:'SANITARIOS'}]};
  else if(url.endsWith('/apply'))data={nuevos:2,actualizados:0,rows:[{id:'012177',codigo:'TEST'},{id:'012178',codigo:'OTRO'}]};
  else if(url.includes('/article?'))data={id:'012177',descripcion:'ARTICULO TEST',venta3:157.3,version:'saved'};
  else if(url.endsWith('/publish')){
    if(rejectPublishToken){rejectPublishToken=false;return{ok:false,status:403,json:async()=>({error:'Token vencido'})};}
    if(fail)throw new Error('Sin Internet');
    data={ok:true};
  }else throw new Error(url);
  return{ok:true,json:async()=>data};
};
window.CorralonSystem.articleSync={set(state,message,options){lastProgress={state,message,options};}};
const source=await readFile(new URL('../local-article-importer.js',import.meta.url),'utf8');
const importer=await import(`data:text/javascript;base64,${Buffer.from(source.replace('./local-article-sync.js',new URL('../local-article-sync.js',import.meta.url).href)).toString('base64')}`);
await importer.open({provider:{id_proveedor:1,proveedor:'PROVEEDOR'},rows:[{codigo:'TEST',descripcion:'ARTICULO TEST',costo:100,idRubro:1},{codigo:'OTRO',descripcion:'OTRO ARTICULO',costo:200,idRubro:1}]});
let check=document.querySelector('[data-load-web]');
check.checked=true;check.dispatchEvent(new window.Event('change',{bubbles:true}));
assert.ok(editor,'check opens shared editor');
assert.equal(calls.filter(c=>c.url.endsWith('/apply')).length,0,'opening does not save SQL');
assert.equal(editor.articles[0].fotoUrl,undefined,'starts without metadata');
assert.equal(editor.operation.deferImages,true,'photos stay local until importing');
const localPhoto='data:image/jpeg;base64,'+'eA=='.repeat(600000);
const edited={...editor.articles[0],detalle:'Detalle escrito',imagenes:[localPhoto],fotoUrl:localPhoto,destacado:true};
await editor.operation.save([],edited);
assert.equal(calls.filter(c=>c.url.endsWith('/apply')||c.url.endsWith('/publish')||c.url==='upload-photo').length,0,'popup save writes only local draft');
assert.equal(document.querySelectorAll('tbody tr').length,2);
editor.operation.onClose();
assert.equal(document.querySelector('[data-load-web]').checked,true,'staged keeps check');
const marker=JSON.parse(window.localStorage.getItem('corralon_local_article_import_draft_v1_1'));
assert.deepEqual(marker,{indexedDb:true},'localStorage has only a small marker');
const local=draftCache.get('corralon_local_article_import_draft_v1_1');
assert.equal(local.rows[0].webDraft.detalle,'Detalle escrito');
assert.equal(local.rows[0].webDraft.fotoUrl,edited.fotoUrl,'photo persists locally');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const waitFor=async condition=>{for(let i=0;i<50;i++){if(condition())return;await tick();}throw new Error('El flujo no terminó');};
document.querySelector('[data-close]').click();await tick();
await importer.open({provider:{id_proveedor:1,proveedor:'PROVEEDOR'},rows:[]});
assert.equal(document.querySelectorAll('tbody tr').length,2,'reopens the durable draft');
assert.equal(draftCache.get('corralon_local_article_import_draft_v1_1').rows[0].webDraft.fotoUrl,localPhoto,'large photo survives reopening');
check=document.querySelectorAll('[data-load-web]')[1];
check.checked=true;check.dispatchEvent(new window.Event('change',{bubbles:true}));
await editor.operation.save([],{...editor.articles[0],detalle:'SEGUNDO',imagenes:['data:image/jpeg;base64,eA=='],fotoUrl:'data:image/jpeg;base64,eA=='});
editor.operation.onClose();
document.querySelector('[data-apply]').click();await waitFor(()=>lastProgress?.state==='error');
assert.equal(calls.find(c=>c.url.endsWith('/apply')).body.rows.length,2,'Apply saves entire batch');
assert.equal(document.querySelector('.local-articles-backdrop'),null,'importer closes while background job continues');
assert.equal(draftCache.get('corralon_local_article_sync_queue_v1')[0].rows.length,2,'pending batch is durable');
assert.equal(uploadsPeak,2,'uploads multiple article photos concurrently');
assert.equal(uploadsActive,0,'all uploads finish before reporting publication failure');
assert.equal(calls.filter(c=>c.url.endsWith('/publish')).length,1,'publishes a single batch request');
assert.match(lastProgress.message,/SQL guardado/);
assert.equal(calls.filter(c=>c.url.endsWith('/apply')).length,1);
assert.ok(calls.findIndex(c=>c.url.endsWith('/apply'))<calls.findIndex(c=>c.url==='upload-photo'),'SQL before photo upload');
fail=false;
await lastProgress.options.retry();await waitFor(()=>lastProgress.state==='success');
assert.equal(calls.filter(c=>c.url.endsWith('/apply')).length,1,'publication retry does not repeat SQL');
assert.equal(document.querySelector('.local-articles-backdrop'),null,'closes after successful publication');
const published=calls.filter(c=>c.url.endsWith('/publish')).at(-1).body;
assert.equal(published.articles.length,2);
assert.equal(published.articles[0].id,'012177');
assert.equal(published.articles[0].article.detalle,'Detalle escrito');
assert.equal(published.articles[0].article.fotoUrl,'https://example.com/foto.jpg');
assert.equal(published.articles[0].article.destacado,true);
assert.equal(published.articles[1].id,'012178');
assert.equal(published.articles[1].article.detalle,'SEGUNDO');
assert.equal(calls.filter(c=>c.url==='upload-photo').length,2,'retry does not upload successful photos again');
console.log('PASS durable large photo, concurrent uploads, single batch publication, retry without SQL or photo duplicates');

const {enqueue}=await import(new URL('../local-article-sync.js',import.meta.url));
const before=calls.length;
const base={mode:'new',id:'',codigo:'QUEUE',descripcion:'QUEUED',costo:100,rubro:1,iva:.21,margen:30};
await Promise.all([
  enqueue({operation:'queued-first',provider:1,rows:[{...base,loadWeb:true,webDraft:{imagenes:[],fotoUrl:'',detalle:'FIRST'}}]}),
  enqueue({operation:'queued-second',provider:1,rows:[{...base,codigo:'SECOND'}]})
]);
await waitFor(()=>draftCache.get('corralon_local_article_sync_queue_v1').length===0);
const queueCalls=calls.slice(before).filter(call=>call.url.endsWith('/apply')||call.url.endsWith('/publish'));
assert.deepEqual(queueCalls.map(call=>call.url.split('/').at(-1)),['apply','publish','apply'],'FIFO: second SQL waits for first publication');
assert.equal(queueCalls[0].body.operation,'queued-first');
assert.equal(queueCalls[2].body.operation,'queued-second');
console.log('PASS rapid submissions execute in FIFO order with background progress');

draftCache.set('corralon_local_article_sync_queue_v1',[{id:'resume',operation:'resume',provider:1,state:'running',rows:[{...base,sqlSaved:{id:'012179'},loadWeb:true,webDraft:{fotoUrl:'https://example.com/foto.jpg',imagenes:['https://example.com/foto.jpg'],detalle:'RECUPERADO'}}]}]);
const beforeResume=calls.length;rejectPublishToken=true;
const resumed=await import(new URL('../local-article-sync.js?resume-test',import.meta.url));
await resumed.resumeQueue();
await waitFor(()=>draftCache.get('corralon_local_article_sync_queue_v1').length===0);
const resumeCalls=calls.slice(beforeResume);
assert.equal(resumeCalls.filter(call=>call.url.endsWith('/apply')).length,0,'recovery does not repeat committed SQL');
assert.equal(resumeCalls.filter(call=>call.url.endsWith('/publish')).length,2,'expired token renewed before retry');
assert.equal(resumeCalls.filter(call=>call.url==='upload-photo').length,0,'recovery preserves uploaded photos');
console.log('PASS reload recovery and token renewal without repeating SQL or photo uploads');

// Exercise the real shared editor save path with an actual File/FileReader.
const system=await readFile(new URL('../corralon-system.js',import.meta.url),'utf8');
const photo=new window.File(['photo bytes'],'foto.jpg',{type:'image/jpeg'});
const button={disabled:false,textContent:''};
let stored,closed=false;
const seed={codigo:'draft-id',nombre:'ARTICULO',precio:100};
const context={
  FileReader:window.FileReader,CustomEvent:window.CustomEvent,window,console,URL:{revokeObjectURL(){}},
  articleEditorOperation:{articles:[seed],deferImages:true,async save(list,article){stored=article;}},
  articleEditorAdapter:{},articleEditorOriginalCode:seed.codigo,articleEditorBasePrice:100,
  articleEditorImages:['blob:local-photo'],articleEditorImageFiles:new Map([['blob:local-photo',photo]]),
  articleEditorApplyTargets:new Set(),articleEditorAridEligible:false,
  articleEditorHost:{querySelector(selector){return selector==='[data-editor-save]'?button:{classList:{contains:()=>false}};}},
  articleCode:a=>a.codigo,articleTags:v=>String(v).split(',').filter(Boolean),
  editorField:key=>({value:key==='detalle'?'DETALLE LOCAL':''}),
  readArticleEditorAridConfig:()=>({precios:{}}),readArticleEditorFreightConfig:()=>({}),
  parseFlexibleNumber:Number,closeArticleEditor(){assert.equal(button.disabled,false);closed=true;},
  alert(message){throw new Error(message);},
  uploadArticleImage(){throw new Error('Popup save must not upload');}
};
vm.createContext(context);
vm.runInContext(system.slice(system.indexOf('  function articleImageDataUrl('),system.indexOf('  async function publishArticleImages('))+
  system.slice(system.indexOf('  async function saveArticleEditor('),system.indexOf('  function escapeAridHtml(')),context);
await context.saveArticleEditor();
assert.ok(closed,'real editor closes after local save');
assert.match(stored.fotoUrl,/^data:image\/jpeg;base64,/,'actual file becomes a durable local photo');
assert.equal(stored.detalle,'DETALLE LOCAL');
assert.equal(JSON.stringify(stored).includes('blob:'),false,'no temporary blob URL in draft');
console.log('PASS shared editor stores File locally without upload and closes correctly');
