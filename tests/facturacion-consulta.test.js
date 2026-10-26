const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','facturacion-consulta.js'),'utf8');
let JSDOM;try{({JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom'))}catch{}
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
test('desde la consulta integrada la boleta es una sección y volver conserva filtros y scroll',async()=>{
 const s=setup();try{
 const host=s.w.document.createElement('section');s.w.document.body.append(host);
 await s.w.CorralonInvoiceHistory.openSection(host,()=>{});
 const list=host.querySelector('.invoice-history-overlay'),scroll=list.querySelector('.invoice-history-scroll');
 list.querySelector('[data-search]').value='Filtro conservado';scroll.scrollTop=120;
 list.querySelector('[data-invoice="0"]').click();await tick();
 const detail=host.querySelector('.invoice-receipt-detail');assert.ok(detail);assert.equal(detail.hidden,false);
 assert.equal(host.dataset.detailOpen,'true');assert.equal(detail.getAttribute('role'),'region');assert.equal(detail.hasAttribute('aria-modal'),false);
 detail.querySelector('[data-detail-close]').click();
 assert.equal(host.dataset.detailOpen,'false');assert.equal(detail.hidden,true);
 assert.equal(list.querySelector('[data-search]').value,'Filtro conservado');assert.equal(scroll.scrollTop,120);
 }finally{s.dom.window.close()}
});
test('artículo se combina con cliente y se conserva al paginar; se limpia al reabrir',{skip:!JSDOM},async()=>{const s=setup({more:true});try{s.w.document.getElementById('consultInvoices').click();await tick();s.w.document.querySelector('[data-search]').value='PEREZ';s.w.document.querySelector('[data-article]').value='pegamento';s.w.document.querySelector('form').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();let query=new URL(s.calls.at(-1).url,'http://localhost').searchParams;assert.equal(query.get('buscar'),'PEREZ');assert.equal(query.get('articulo'),'pegamento');s.w.document.querySelector('.invoice-history-scroll').dispatchEvent(new s.w.Event('scroll'));await tick();query=new URL(s.calls.at(-1).url,'http://localhost').searchParams;assert.equal(query.get('pagina'),'1');assert.equal(query.get('articulo'),'pegamento');s.w.document.querySelector('[data-close]').click();s.w.document.getElementById('consultInvoices').click();await tick();assert.equal(s.w.document.querySelector('[data-article]').value,'')}finally{s.dom.window.close()}});
function setup(settings={}){
  const dom=new JSDOM('<button id="consultInvoices">Consultar</button>',{url:'http://localhost:8080/gestion.html',runScripts:'outside-only'}),w=dom.window,calls=[];let fail=false;
  w.CorralonFunciones={menuUserIsAdministrator:()=>false,parseFechaFlexible:value=>{const [day,month,year]=value.split('/').map(Number),date=new Date(year,month-1,day);return{date,text:value}}};
  const records=[1,2].map(id=>({idRecibo:id,numero:'0004-0000000'+id,tipo:'PRES. ESPECIAL',cliente:'Cliente SQL '+id,sucursal:'Progreso',fecha:'02/10/2026',total:100,anulada:0}));
  w.fetch=async(url,options)=>{calls.push({url,options});if(fail&&url.includes('consultar-comprobantes'))throw new Error('SQL no disponible');const requestedPage=Number(new URL(url,'http://localhost').searchParams.get('pagina')||0);const result=url.endsWith('bootstrap')?{ok:true,sucursales:[{id:1,nombre:'Progreso'}]}:url.includes('consultar-comprobantes')?{ok:true,comprobantes:records.map(r=>({...r,idRecibo:r.idRecibo+requestedPage*2})),pagina:requestedPage,totalComprobantes:settings.more?6:2,hayMas:Boolean(settings.more&&requestedPage<2)}:{ok:true,comprobante:{cliente:'Cliente SQL',fechaComprobante:'2026-10-02',confirmado:-1,anulada:0,total:100},articulos:[{idart:'000001',descripcion:'ARTÍCULO SQL',cantidad:1,precio:100,importe:100}],valores:[{tipo:'Efectivo',importe:100,impRec:0,total:100}]};return{ok:true,json:async()=>result}};
  Object.defineProperty(w,'localStorage',{get(){throw new Error('No debe usar caché local')}});Object.defineProperty(w,'indexedDB',{get(){throw new Error('No debe usar borradores')}});
  w.eval(source);return{dom,w,calls,fail:()=>{fail=true}};
}

test('detalle agrupa sus datos y busca artículos localmente sin alterar importes',{skip:!JSDOM},async()=>{
 const s=setup();try{
  await s.w.CorralonInvoiceHistory.openInvoice(1,[{idRecibo:1,tipo:'Factura A'}]);
  const d=s.w.document,panel=d.querySelector('.invoice-receipt-detail'),search=panel.querySelector('[data-receipt-article-search]'),row=panel.querySelector('[data-warranty-article]');
  assert.deepEqual([...panel.querySelectorAll('.receipt-section-title')].map(el=>el.firstChild.textContent),['Datos principales','Detalle de artículos','Valores recibidos','Resumen de totales','Totales y otros datos']);
  const requests=s.calls.length,total=panel.querySelector('.receipt-total').textContent;
  search.value='no coincide';search.dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(row.hidden,true);assert.match(panel.querySelector('.receipt-articles .receipt-records').textContent,/0 de 1/);
  search.value='articulo sql';search.dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(row.hidden,false);
  search.value='';search.dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(row.hidden,false);assert.equal(panel.querySelector('tr.receipt-empty').hidden,false);
  assert.equal(s.calls.length,requests);assert.equal(panel.querySelector('.receipt-total').textContent,total);
 }finally{s.dom.window.close()}
});
test('cada apertura consulta SQL sin caché ni borradores',{skip:!JSDOM},async()=>{const s=setup();try{s.w.document.getElementById('consultInvoices').click();await tick();assert.equal(s.w.document.querySelectorAll('tr[data-invoice]').length,2);s.w.document.querySelector('[data-close]').click();s.w.document.getElementById('consultInvoices').click();await tick();assert.equal(s.calls.filter(c=>c.url.includes('consultar-comprobantes')).length,2);assert.ok(s.calls.every(c=>c.options.cache==='no-store'))}finally{s.dom.window.close()}});

test('detalle mantiene su distribución al escalar entre monitores sin volver a consultar',{skip:!JSDOM},async()=>{
 const s=setup();try{
  await s.w.CorralonInvoiceHistory.openInvoice(1,[{idRecibo:1,tipo:'Factura A'}]);
  const d=s.w.document,card=d.querySelector('.invoice-receipt-detail .invoice-history-card'),article=d.querySelector('[data-warranty-article]'),calls=s.calls.length;
  for(const [width,height] of [[1280,720],[1366,768],[1920,1080],[2560,1440]]){
   Object.defineProperty(s.w,'innerWidth',{value:width,configurable:true});Object.defineProperty(s.w,'innerHeight',{value:height,configurable:true});s.w.dispatchEvent(new s.w.Event('resize'));
   const scale=Number(card.style.getPropertyValue('--receipt-scale'));
   assert.equal(scale,Math.min((width-28)/1450,(height-28)/850));assert.ok(1450*scale<=width-28);assert.ok(850*scale<=height-28);
   assert.equal(d.querySelector('[data-warranty-article]'),article);
  }
  assert.equal(s.calls.length,calls);
 }finally{s.dom.window.close()}
});
test('abrir y navegar las boletas vuelve a consultar cada detalle en SQL',{skip:!JSDOM},async()=>{const s=setup();try{s.w.document.getElementById('consultInvoices').click();await tick();s.w.document.querySelector('tr[data-invoice]').click();await tick();assert.match(s.w.document.querySelector('[data-detail-body]').textContent,/ARTÍCULO SQL/);assert.match(s.w.document.querySelector('[data-detail-body]').textContent,/Efectivo/);s.w.document.querySelector('[data-detail-next]').click();await tick();assert.equal(s.calls.filter(c=>c.url.includes('comprobante?id=')).length,2);s.w.document.querySelector('[data-detail-prev]').click();await tick();assert.equal(s.calls.filter(c=>c.url.includes('comprobante?id=')).length,3)}finally{s.dom.window.close()}});
test('si SQL falla muestra el error y no conserva una lista anterior',{skip:!JSDOM},async()=>{const s=setup();try{s.w.document.getElementById('consultInvoices').click();await tick();s.fail();s.w.document.querySelector('form').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(s.w.document.querySelectorAll('tr[data-invoice]').length,0);assert.match(s.w.document.querySelector('[data-status]').textContent,/SQL no disponible/)}finally{s.dom.window.close()}});
test('la consulta se agrega al lado de reimprimir sin persistir datos',()=>{const html=fs.readFileSync(path.join(__dirname,'..','gestion.html'),'utf8');assert.match(html,/Reimprimir últ\. fact\.<\/button><button id="consultInvoices"/);assert.doesNotMatch(source,/localStorage\.setItem|sessionStorage|indexedDB|allDrafts|putDraft/)});
test('los botones actúan sobre la boleta seleccionada y llamar cierra el popup',{skip:!JSDOM},async()=>{const s=setup(),actions=[];try{s.w.CorralonInvoiceHistoryActions={reprint:async id=>actions.push(['reprint',id]),recall:async id=>actions.push(['recall',id])};s.w.document.getElementById('consultInvoices').click();await tick();s.w.document.querySelectorAll('tr[data-invoice]')[1].click();await tick();s.w.document.querySelector('[data-reprint]').click();await tick();assert.deepEqual(actions,[['reprint',2]]);assert.match(s.w.document.querySelector('[data-action-status]').textContent,/Ticket enviado/);s.w.document.querySelector('[data-recall]').click();await tick();assert.deepEqual(actions,[['reprint',2],['recall',2]]);assert.ok([...s.w.document.querySelectorAll('.invoice-history-overlay')].every(el=>el.hidden))}finally{s.dom.window.close()}});
test('si falla la acción conserva el detalle y permite reintentar',{skip:!JSDOM},async()=>{const s=setup();try{s.w.CorralonInvoiceHistoryActions={reprint:async()=>{throw new Error('Impresora sin conexión')}};s.w.document.getElementById('consultInvoices').click();await tick();s.w.document.querySelector('tr[data-invoice]').click();await tick();s.w.document.querySelector('[data-reprint]').click();await tick();assert.match(s.w.document.querySelector('[data-action-status]').textContent,/Impresora sin conexión/);assert.equal(s.w.document.querySelector('[data-reprint]').disabled,false);assert.equal(s.w.document.querySelector('[data-detail-body]').closest('.invoice-history-overlay').hidden,false)}finally{s.dom.window.close()}});

test('Caja reutiliza el detalle dentro de su dialogo y conserva navegacion y foco',{skip:!JSDOM},async()=>{const s=setup();try{const host=s.w.document.createElement('dialog'),row=s.w.document.createElement('button');host.append(row);s.w.document.body.append(host);row.focus();await s.w.CorralonInvoiceHistory.openInvoice(1,[{idRecibo:1,numero:'0004-00000001'},{idRecibo:2,numero:'0004-00000002'}],{host});const detail=host.querySelector('.invoice-receipt-detail');assert.ok(detail);assert.equal(detail.hidden,false);assert.match(detail.textContent,/ARTÍCULO SQL/);detail.querySelector('[data-detail-next]').click();await tick();assert.ok(s.calls.some(c=>c.url.includes('comprobante?id=2')));detail.querySelector('[data-detail-close]').click();assert.equal(detail.hidden,true);assert.equal(s.w.document.activeElement,row);}finally{s.dom.window.close()}});

test('encabezados alternan ascendente, descendente y original conservando filtros y paginación',{skip:!JSDOM},async()=>{
 const s=setup({more:true});try{
  s.w.document.getElementById('consultInvoices').click();await tick();
  const d=s.w.document;d.querySelector('[data-search]').value='PEREZ';d.querySelector('[data-article]').value='cemento';
  for(const field of ['numero','tipo','cliente','sucursal','fecha','total','estado']){
   const button=d.querySelector(`[data-sort="${field}"]`);assert.ok(button);
   for(const direction of ['asc','desc','']){
    button.click();await tick();const query=new URL(s.calls.at(-1).url,'http://localhost').searchParams;
    assert.equal(query.get('orden'),direction?field:'');assert.equal(query.get('direccion'),direction);assert.equal(query.get('pagina'),'0');
    assert.equal(query.get('buscar'),'PEREZ');assert.equal(query.get('articulo'),'cemento');
    assert.equal(button.closest('th').getAttribute('aria-sort'),direction==='asc'?'ascending':direction==='desc'?'descending':'none');
   }
  }
  d.querySelector('[data-sort="total"]').click();await tick();d.querySelector('.invoice-history-scroll').dispatchEvent(new s.w.Event('scroll'));await tick();
  const query=new URL(s.calls.at(-1).url,'http://localhost').searchParams;assert.equal(query.get('orden'),'total');assert.equal(query.get('direccion'),'asc');assert.equal(query.get('pagina'),'1');
  d.querySelector('[data-close]').click();d.getElementById('consultInvoices').click();await tick();assert.equal(d.querySelector('[data-sort="total"]').closest('th').getAttribute('aria-sort'),'none');
 }finally{s.dom.window.close()}
});

test('scroll acumula bloques sin reemplazar filas, evita pedidos simultáneos y se detiene al final',{skip:!JSDOM},async()=>{
 const s=setup({more:true});try{
  const d=s.w.document;d.getElementById('consultInvoices').click();await tick();
  const panel=d.querySelector('.invoice-history-scroll'),first=d.querySelector('tr[data-invoice]');
  for(let i=0;i<5;i++)panel.dispatchEvent(new s.w.Event('scroll'));await tick();
  assert.equal(d.querySelectorAll('tr[data-invoice]').length,4);assert.equal(d.querySelector('tr[data-invoice]'),first);assert.equal(d.querySelector('[data-position]').textContent,'4 boletas cargadas de 6');
  assert.equal(s.calls.filter(c=>c.url.includes('consultar-comprobantes')).length,2);
  d.querySelectorAll('tr[data-invoice]')[3].click();await tick();assert.ok(s.calls.some(c=>c.url.includes('comprobante?id=4')));d.querySelector('[data-detail-close]').click();
  panel.dispatchEvent(new s.w.Event('scroll'));await tick();assert.equal(d.querySelectorAll('tr[data-invoice]').length,6);
  assert.equal(d.querySelector('[data-position]').textContent,'6 boletas cargadas de 6');assert.match(d.querySelector('[data-more-status]').textContent,/No hay más/);
  panel.dispatchEvent(new s.w.Event('scroll'));await tick();assert.equal(s.calls.filter(c=>c.url.includes('consultar-comprobantes')).length,3);
  assert.equal(d.querySelector('[data-next]'),null);
 }finally{s.dom.window.close()}
});
test('cambiar orden después de acumular reinicia en SQL desde cero con todos los filtros',{skip:!JSDOM},async()=>{
 const s=setup({more:true});try{
  const d=s.w.document;d.getElementById('consultInvoices').click();await tick();
  d.querySelector('.invoice-history-scroll').dispatchEvent(new s.w.Event('scroll'));await tick();assert.equal(d.querySelectorAll('tr[data-invoice]').length,4);
  d.querySelector('[data-sort="total"]').click();await tick();assert.equal(d.querySelectorAll('tr[data-invoice]').length,2);
  let q=new URL(s.calls.at(-1).url,'http://localhost').searchParams;assert.equal(q.get('pagina'),'0');assert.equal(q.get('orden'),'total');
  d.querySelector('.invoice-history-scroll').dispatchEvent(new s.w.Event('scroll'));await tick();q=new URL(s.calls.at(-1).url,'http://localhost').searchParams;
  assert.equal(q.get('pagina'),'1');assert.equal(q.get('orden'),'total');assert.equal(d.querySelectorAll('tr[data-invoice]').length,4);
 }finally{s.dom.window.close()}
});
test('error al cargar otro bloque conserva lo visible y permite reintentar sin duplicarlo',{skip:!JSDOM},async()=>{
 const s=setup({more:true});try{
  const d=s.w.document;d.getElementById('consultInvoices').click();await tick();const fetch=s.w.fetch;
  s.w.fetch=async(url,options)=>{if(new URL(url,'http://localhost').searchParams.get('pagina')==='1')throw Error('Corte de conexión');return fetch(url,options)};
  d.querySelector('.invoice-history-scroll').dispatchEvent(new s.w.Event('scroll'));await tick();
  assert.equal(d.querySelectorAll('tr[data-invoice]').length,2);assert.equal(d.querySelector('[data-retry-more]').hidden,false);
  s.w.fetch=fetch;d.querySelector('[data-retry-more]').click();await tick();assert.equal(d.querySelectorAll('tr[data-invoice]').length,4);assert.equal(d.querySelector('[data-retry-more]').hidden,true);
 }finally{s.dom.window.close()}
});

test('el número con guion completa punto de venta y factura sin modificar nombres de cliente',{skip:!JSDOM},async()=>{
 const s=setup();try{
  s.w.document.getElementById('consultInvoices').click();await tick();
  const field=s.w.document.querySelector('[data-search]'),form=s.w.document.querySelector('form');
  for(const [typed,expected] of [['9-823','0009-00000823'],[' 9 – 823 ','0009-00000823'],['0009-00000823','0009-00000823'],['PEREZ-9','PEREZ-9'],['823','823']]){
   field.value=typed;form.dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();
   assert.equal(field.value,expected);
   assert.equal(new URL(s.calls.at(-1).url,'http://localhost').searchParams.get('buscar'),expected);
  }
  field.value='6-125';field.dispatchEvent(new s.w.Event('blur'));assert.equal(field.value,'0006-00000125');
 }finally{s.dom.window.close()}
});

test('buscar boleta completa ignora filtros y buscar cliente vuelve a respetarlos sin borrarlos',{skip:!JSDOM},async()=>{
 const s=setup();try{
  s.w.document.getElementById('consultInvoices').click();await tick();const d=s.w.document;
  d.querySelector('[data-branch]').value='1';
  d.querySelector('[data-point]').innerHTML='<option value="6">Puesto 6</option>';d.querySelector('[data-point]').value='6';
  d.querySelector('[data-from]').value='01/01/2026';d.querySelector('[data-to]').value='19/10/2026';
  d.querySelector('[data-article]').value='cemento';d.querySelector('[data-search]').value='9-823';
  d.querySelector('form').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();
  let q=new URL(s.calls.at(-1).url,'http://localhost').searchParams;
  assert.equal(q.get('buscar'),'0009-00000823');assert.equal(q.get('sucursal'),'0');assert.equal(q.get('puntoVenta'),'0');assert.equal(q.get('articulo'),'');assert.equal(q.get('desde'),'1753-01-01');assert.equal(q.get('hasta'),'9998-12-31');
  assert.equal(d.querySelector('[data-branch]').value,'1');assert.equal(d.querySelector('[data-article]').value,'cemento');
  d.querySelector('[data-search]').value='PEREZ';d.querySelector('form').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();
  q=new URL(s.calls.at(-1).url,'http://localhost').searchParams;
  assert.equal(q.get('sucursal'),'1');assert.equal(q.get('puntoVenta'),'6');assert.equal(q.get('articulo'),'cemento');assert.equal(q.get('desde'),'2026-01-01');assert.equal(q.get('hasta'),'2026-10-19');
  d.querySelector('[data-from]').value='';d.querySelector('[data-to]').value='';d.querySelector('[data-search]').value='6-125';
  d.querySelector('form').dispatchEvent(new s.w.Event('submit',{cancelable:true}));await tick();assert.equal(new URL(s.calls.at(-1).url,'http://localhost').searchParams.get('buscar'),'0006-00000125');
 }finally{s.dom.window.close()}
});

test('vincular desde consulta permite abrir el detalle completo antes de resolver',async()=>{
 const s=setup();try{const host=s.w.document.createElement('section');s.w.document.body.append(host);let linked=null,accepted=false;const sections=[];
 s.w.confirm=()=>accepted;s.w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 s.w.CorralonInvoiceSections={show:section=>{sections.push(section);if(section==='invoice-consult')s.w.CorralonInvoiceHistory.openSection(host,()=>{});else s.w.CorralonInvoiceHistory.suspendSection();return true;}};
 await s.w.CorralonInvoiceHistory.selectForReview({onSelect:async detail=>{linked=detail;}});await tick();
 assert.equal(sections[0],'invoice-consult');assert.match(host.querySelector('h2').textContent,/Vincular venta realizada/);assert.equal(host.querySelectorAll('button[data-invoice]').length,2);
 host.querySelector('[data-invoice]').click();await tick();const detail=host.querySelector('.invoice-receipt-detail');assert.match(detail.textContent,/ARTÍCULO SQL/);assert.match(detail.textContent,/Efectivo/);
 const link=detail.querySelector('[data-review-link]');assert.equal(link.hidden,false);assert.equal(link.disabled,false);link.click();await tick();assert.equal(linked,null);
 accepted=true;link.click();await tick();assert.equal(linked.articulos[0].idart,'000001');assert.equal(sections.at(-1),'invoice');
 }finally{s.dom.window.close();}
});
