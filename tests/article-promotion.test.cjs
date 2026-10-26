const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const shared=fs.readFileSync('corralon-system.js','utf8'),html=fs.readFileSync('index.html','utf8');
function fn(source,name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?undefined:end);}
function catalog(){const s={window:{},normalizarNumeroConsulta:Number,normalizarImagenesArticulo:()=>[],toBool:Boolean,obtenerTagsOcultosArticulo:()=>[],ceramicoPredeterminado:()=>null,sanitizeM2:Number,sanitizePlacas:Number,clampPct:v=>Math.max(0,Math.min(100,Number(v||0))),sanitizeIsoDate:v=>String(v||''),todayIsoLocal:()=> '2026-10-22',escaparHtml:s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),formatoFechaCortaIso:v=>v};vm.createContext(s);for(const name of ['precioOferta','normalizarArticulo','esOfertaArticulo','construirTagsArticulo','obtenerArticulosPortada'])vm.runInContext(fn(html,name),s);return s;}
test('promoción entra en Ofertas al precio normal y escapa el texto; descuento conserva su precio',()=>{
 const s=catalog(),base={codigo:'008928',precio:141527.63,oferta:true};
 const promo=s.normalizarArticulo({...base,promocion_texto:'20 L + 5 L <regalo>',ofertaPct:20});
 assert.equal(promo.promocionVigente,true);assert.equal(promo.ofertaVigente,false);assert.equal(promo.precioVigente,base.precio);assert.equal(s.esOfertaArticulo(promo),true);
 assert.match(s.construirTagsArticulo(promo),/20 L \+ 5 L &lt;regalo&gt;/);assert.doesNotMatch(s.construirTagsArticulo(promo),/<regalo>/);
 const discount=s.normalizarArticulo({...base,ofertaPct:20,ofertaHasta:'2026-10-23'});assert.equal(discount.ofertaVigente,true);assert.equal(discount.precioVigente,113222.1);
 const expired=s.normalizarArticulo({...base,promocionTexto:'Regalo',ofertaHasta:'2026-10-21'});assert.equal(s.esOfertaArticulo(expired),false);
 s.rankingVentasCargado=false;s.todosArticulos=[promo,expired,{codigo:'normal'}];s.homeLandingConfig={mode:'auto'};s.resolverArticulosPortadaManual=()=>[];s.ordenarArticulosHome=rows=>rows;
 assert.equal(s.obtenerArticulosPortada('oferta',s.esOfertaArticulo,'oferta').length,1);
});
test('editor permite promoción con texto, la guarda sin descuento y la recupera al reabrir',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://example.com',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 try{
 w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.CORRALON_DISABLE_CATALOG_REALTIME=true;w.alert=()=>{};w.fetch=async()=>new Response('{}');w.eval(shared);
 const articles=[{codigo:'008928',nombre:'PINTURA',precio:141527.63,oferta:false}],saved=[];
 const operation={articles,deferImages:true,save:async rows=>{saved.push(...rows)}};
 w.CorralonSystem.articleEditor.open('008928',{articles,operation});const host=w.document.querySelector('.corralon-article-editor-host'),field=name=>host.querySelector(`[data-editor-field="${name}"]`);
 host.querySelector('[data-editor-chip="oferta"]').click();field('ofertaPct').value='25';field('ofertaTipo').value='promocion';field('ofertaTipo').dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(field('ofertaPct').parentElement.hidden,true);assert.equal(field('promocionTexto').parentElement.hidden,false);assert.equal(host.querySelector('[data-editor-info="precioAnterior"]').hidden,true);assert.equal(host.querySelector('[data-editor-info="precioEstado"]').textContent,'PROMOCIÓN');
 host.querySelector('[data-editor-save]').click();await new Promise(r=>setTimeout(r,20));assert.equal(saved.length,0);
 field('promocionTexto').value='Llevá 20 L + 5 L de regalo';host.querySelector('[data-editor-save]').click();await new Promise(r=>setTimeout(r,40));assert.equal(saved.length,1);assert.equal(saved[0].ofertaPct,0);assert.equal(saved[0].precio,141527.63);assert.equal(saved[0].promocionTexto,'Llevá 20 L + 5 L de regalo');
 const mapped=w.CorralonSystem.catalog.fromSupabase({codigo:'008928',nombre:'PINTURA',precio_venta:141527.63,oferta:true,oferta_pct:0,promocion_texto:saved[0].promocionTexto});
 assert.equal(mapped.promocionTexto,saved[0].promocionTexto);
 w.CorralonSystem.articleEditor.open('008928',{articles:[mapped],operation});assert.equal(field('ofertaTipo').value,'promocion');assert.equal(field('promocionTexto').value,saved[0].promocionTexto);
 }finally{dom.window.close()}
});
test('guardado del servidor conserva el texto y elimina cualquier descuento residual',()=>{
 const ts=fs.readFileSync('supabase/functions/editar-catalogo-articulo/index.ts','utf8'),helpers=ts.slice(ts.indexOf('function stringValue('),ts.indexOf('async function sha256(')),payload=ts.slice(ts.indexOf('function editPayload('),ts.indexOf('Deno.serve('));
 const s={};vm.createContext(s);vm.runInContext((helpers+payload).replaceAll(': unknown','').replace('raw: Record<string, unknown>, userId: string','raw, userId'),s);
 const saved=s.editPayload({codigo:'008928',oferta:true,ofertaPct:25,promocionTexto:'20 L + 5 L de regalo'},'test');assert.equal(saved.promocion_texto,'20 L + 5 L de regalo');assert.equal(saved.oferta_pct,0);
 assert.equal(s.editPayload({codigo:'1',oferta:true,ofertaPct:15},'test').oferta_pct,15);
 assert.equal(s.editPayload({codigo:'1',oferta:false,promocionTexto:'Anterior'},'test').promocion_texto,'');
});
