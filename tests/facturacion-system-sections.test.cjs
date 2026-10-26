const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('gestion.html','utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
test('Recibos despliega Consultar con permisos, navega a la lista y admite Ctrl clic',async()=>{
 const s=setup();try{
 s.d.getElementById('systemMenuToggle').click();
 const arrow=s.d.getElementById('systemReceiptsExpand');arrow.click();
 assert.equal(arrow.getAttribute('aria-expanded'),'true');assert.equal(s.d.getElementById('systemReceiptsSubmenu').hidden,false);
 const consult=s.d.querySelector('[data-system-section="receipts-consult"]');
 const opened=[];s.w.open=(...args)=>opened.push(args);
 consult.dispatchEvent(new s.w.MouseEvent('click',{bubbles:true,ctrlKey:true}));
 assert.equal(new URL(opened[0][0]).hash,'#recibos/consultar');assert.equal(s.calls.length,0);
 consult.click();await tick();assert.equal(s.d.getElementById('rc-historyModal').hidden,false);
 assert.equal(s.w.location.hash,'#recibos/consultar');
 s.w.CorralonInvoiceSections.show('receipts');await tick();assert.equal(s.d.getElementById('rc-receiptEmission').hidden,false);
 s.d.getElementById('rc-note').value='Conservar recibo';
 s.w.CorralonInvoiceSections.show('receipts-consult');await tick();assert.equal(s.d.getElementById('rc-historyModal').hidden,false);
 assert.equal(s.d.getElementById('rc-note').value,'Conservar recibo');
 s.setAllowed(false);s.w.dispatchEvent(new s.w.CustomEvent('menu-user-validated',{detail:{user:{id:'test'}}}));
 assert.equal(s.d.querySelector('[data-system-receipts-group]').hidden,true);
 }finally{s.dom.window.close()}
});
test('un clic en cualquier celda abre el recibo dentro de la sección y sólo consulta una vez',async()=>{
 const s=setup();try{
 const baseFetch=s.w.fetch;
 s.w.fetch=async(url,options)=>{
  const query=new URL(url,'http://localhost').searchParams;
  if(query.get('consulta')==='opciones')return baseFetch(url,options);
  s.calls.push({url,options});
  const receipt={id:120,numero:'0005-00000674',fecha:'20/10/2026',cliente:'PRUEBA',total:100,anulado:false};
  return {ok:true,json:async()=>query.get('consulta')==='recibos'?{ok:true,recibos:[receipt]}:{ok:true,version:'v1',recibo:receipt,facturas:[],valores:[]}};
 };
 s.w.CorralonInvoiceSections.show('receipts');await tick();s.d.getElementById('rc-viewReceipts').click();await tick();
 const row=s.d.querySelector('#rc-historyBody [data-receipt-row]');assert.ok(row);
 const before=s.calls.length;row.querySelector('td:nth-child(3)').click();await tick();
 assert.equal(s.calls.length,before+1);assert.equal(new URL(s.calls.at(-1).url,'http://localhost').searchParams.get('id'),'120');
 assert.equal(s.d.getElementById('rc-receiptConsultSection').hidden,false);
 assert.equal(s.d.getElementById('rc-historyModal').hidden,true);
 assert.equal(s.w.location.hash,'#recibos/recibo=120');
 }finally{s.dom.window.close()}
});
test('Ctrl o Command más clic abre la sección elegida sin cambiar la pestaña ni su borrador',()=>{
 const s=setup();try{
 const opened=[];s.w.open=(...args)=>opened.push(args);
 s.d.getElementById('note').value='Venta en curso';s.d.getElementById('systemMenuToggle').click();
 for(const [section,hash]of [['invoice','#facturacion'],['receipts','#recibos/emitir'],['invoice-consult','#facturacion/consultar']]){
  const button=s.d.querySelector(`button[data-system-section="${section}"]`);
  button.dispatchEvent(new s.w.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  assert.equal(new URL(opened.at(-1)[0]).hash,hash);assert.equal(opened.at(-1)[1],'_blank');assert.equal(opened.at(-1)[2],'noopener');
 }
 assert.equal(s.d.getElementById('note').value,'Venta en curso');assert.equal(s.d.getElementById('systemMenu').hidden,false);
 assert.equal(s.d.body.dataset.systemSection,undefined);assert.equal(s.calls.length,0);
 s.d.getElementById('systemReceiptsOption').dispatchEvent(new s.w.MouseEvent('click',{bubbles:true,metaKey:true}));assert.equal(opened.length,4);
 }finally{s.dom.window.close()}
});
function setup(allowed=true){
 const dom=new JSDOM(html,{url:'http://localhost:8080/gestion.html',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()}),w=dom.window,d=w.document,calls=[];
 w.CSS={escape:value=>value};w.matchMedia=()=>({matches:false});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.REPRINT_CAJA_ID=0;
 w.CorralonFunciones={menuUserHasAccess:id=>id==='facturacion'||allowed,menuSessionUser:()=>({id:'test'}),menuUserIsAdministrator:()=>true,
  bindFlexibleDates(){},bindFieldRestore(){},bindLinearNavigation(){},bindLabelSelect(){},bindLiveCurrency(){},
  parseLocaleNumber:v=>Number(v.replace(/\./g,'').replace(',','.')),
  bindTextDropdown:()=>({getValue:()=>0,setValue(){},destroy(){}})};
 w.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({ok:true,puntosVenta:[{id:4,nombre:'Progreso'}],clientes:[],pagos:[],valores:[],tarjetas:[],recibos:[]})}};
 let cajaModule=null;w.createIntegratedCaja=(host,view)=>{host.dataset.initialView=view;cajaModule={canLeave:()=>true,setActive(){},navigate(){}};return cajaModule;};
 w.eval(d.getElementById('invoice-system-navigation').textContent);
 return{dom,w,d,calls,get cajaModule(){return cajaModule},setAllowed:value=>allowed=value};
}
test('los scripts integrados tienen sintaxis válida y Menú es el primero del encabezado',()=>{
 const dom=new JSDOM(html,{virtualConsole:new VirtualConsole()});try{
 for(const script of dom.window.document.querySelectorAll('script:not([src])'))new vm.Script(script.textContent);
 assert.equal(dom.window.document.querySelector('.topbar').firstElementChild.id,'systemMenuToggle');
 assert.equal(dom.window.document.querySelector('#openReceipts'),null);
 assert.equal(dom.window.document.getElementById('systemReceiptsTemplate').content.querySelector('[data-system-open-menu]'),null);
 assert.ok(!dom.window.document.querySelector('#systemReceipts iframe'));
 }finally{dom.window.close()}
});
test('carga Recibos una vez dentro de la sección, conserva ambos formularios y no abre otra página',async()=>{
 const s=setup();try{
 assert.equal(s.calls.length,0);assert.equal(s.d.getElementById('systemReceipts').children.length,0);
 s.d.getElementById('note').value='Venta sin confirmar';
 s.d.getElementById('systemMenuToggle').click();assert.equal(s.d.getElementById('systemMenu').hidden,false);
 s.d.getElementById('systemReceiptsOption').click();await tick();
 assert.equal(s.w.location.pathname,'/gestion.html');assert.equal(s.d.body.dataset.systemSection,'receipts');
 assert.match(s.d.getElementById('rc-status').textContent,/Listo para emitir/);
 assert.equal(s.calls.length,1);assert.match(s.calls[0].url,/recibos-cobro/);assert.ok(!s.calls[0].options.method);
 assert.equal(s.d.getElementById('rc-point').value,'4');assert.ok(s.d.getElementById('rc-addInvoice'));
 s.d.getElementById('rc-note').value='Borrador del recibo';
 s.d.getElementById('rc-billing').click();await tick();assert.equal(s.d.body.dataset.systemSection,'invoice');
 assert.equal(s.d.getElementById('note').value,'Venta sin confirmar');
 s.w.CorralonInvoiceSections.show('receipts');await tick();
 assert.equal(s.d.getElementById('rc-note').value,'Borrador del recibo');assert.equal(s.calls.length,1);
 s.d.getElementById('systemMenuToggle').click();assert.equal(s.d.getElementById('systemMenu').hidden,false);
 s.d.getElementById('systemMenuClose').click();await new Promise(resolve=>setTimeout(resolve,300));assert.equal(s.d.getElementById('systemMenu').hidden,true);
 s.d.getElementById('rc-note').click();assert.equal(s.d.getElementById('rc-note').value,'Borrador del recibo');
 const ids=[...s.d.querySelectorAll('[id]')].map(n=>n.id);assert.equal(ids.length,new Set(ids).size);
 }finally{s.dom.window.close()}
});
test('respeta permiso de Recibos y bloquea cambiar mientras confirma',async()=>{
 const s=setup(false);try{
 assert.equal(s.d.getElementById('systemReceiptsOption').hidden,true);
 assert.equal(s.w.CorralonInvoiceSections.show('receipts'),false);assert.equal(s.calls.length,0);
 s.setAllowed(true);s.w.dispatchEvent(new s.w.CustomEvent('menu-user-validated',{detail:{user:{id:'test'}}}));
 assert.equal(s.d.getElementById('systemReceiptsOption').hidden,false);
 s.w.CorralonInvoiceSections.show('receipts');await tick();s.d.getElementById('systemReceipts').dataset.busy='true';
 assert.equal(s.w.CorralonInvoiceSections.show('invoice'),false);
 }finally{s.dom.window.close()}
});
test('consultar recibos navega dentro de la sección y volver no borra el borrador',async()=>{
 const s=setup();try{
 s.w.CorralonInvoiceSections.show('receipts');await tick();
 s.d.getElementById('rc-note').value='Conservar';s.d.getElementById('rc-viewReceipts').click();await tick();
 assert.equal(s.d.getElementById('rc-historyModal').hidden,false);assert.equal(s.w.location.hash,'#recibos/consultar');
 assert.equal(s.d.querySelector('.topbar .brand b').textContent,'Consultar recibos de cobro');
 assert.equal(s.d.getElementById('systemReceiptHeaderActions').hidden,false);
 s.d.querySelector('#systemReceiptHeaderActions [data-close="historyModal"]').click();await tick();
 assert.equal(s.d.getElementById('rc-receiptEmission').hidden,false);assert.equal(s.d.getElementById('rc-note').value,'Conservar');
 assert.equal(s.w.location.hash,'#recibos/emitir');
 assert.equal(s.d.querySelector('.topbar .brand b').textContent,'Recibos de cobro');
 assert.equal(s.d.getElementById('systemReceiptHeaderActions').hidden,true);
 }finally{s.dom.window.close()}
});
test('atajos de Facturación se suspenden en Recibos y vuelven al regresar',()=>{
 const s=setup();try{
 s.w.eval(html.slice(html.indexOf('function invoiceDocumentEvent('),html.indexOf("const DB_NAME='corralon_facturacion_v1'")));
 let count=0;s.w.invoiceDocumentEvent('keydown',()=>count++);
 s.d.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'F2'}));assert.equal(count,1);
 s.d.body.dataset.systemSection='receipts';s.d.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'F2'}));assert.equal(count,1);
 s.d.body.dataset.systemSection='invoice';s.d.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'F2'}));assert.equal(count,2);
 assert.match(s.d.getElementById('invoice-system-styles').textContent,/@page system-receipt/);
 }finally{s.dom.window.close()}
});
test('flecha despliega Consultar sin navegar y abre la consulta como sección conservando la venta',async()=>{
 const s=setup();try{
 s.w.CorralonFunciones.parseFechaFlexible=value=>{const [day,month,year]=value.split('/').map(Number);return {date:new Date(year,month-1,day),text:value};};
 s.w.fetch=async url=>{s.calls.push({url});return {ok:true,json:async()=>url.endsWith('bootstrap')?{ok:true,sucursales:[{id:1,nombre:'Progreso'}],puntosVenta:[]}:{ok:true,comprobantes:[],hayMas:false,totalComprobantes:0,pagina:0}};};
 s.w.eval(fs.readFileSync('facturacion-consulta.js','utf8'));
 s.d.getElementById('note').value='Conservar esta venta';s.d.getElementById('systemMenuToggle').click();
 const arrow=s.d.getElementById('systemInvoiceExpand');arrow.click();
 assert.equal(arrow.getAttribute('aria-expanded'),'true');assert.equal(s.d.getElementById('systemInvoiceSubmenu').hidden,false);
 assert.equal(s.d.body.dataset.systemSection,undefined);assert.equal(s.d.getElementById('systemMenu').hidden,false);
 s.d.querySelector('button[data-system-section="invoice-consult"]').click();await tick();
 assert.equal(s.d.body.dataset.systemSection,'invoice-consult');assert.equal(s.w.location.hash,'#facturacion/consultar');
 const host=s.d.getElementById('systemInvoiceConsult'),list=host.querySelector('.invoice-history-overlay');
 assert.ok(list);assert.equal(list.hidden,false);assert.equal(list.getAttribute('role'),'region');assert.equal(list.hasAttribute('aria-modal'),false);
 assert.equal(s.d.getElementById('note').value,'Conservar esta venta');
 host.querySelector('[data-close]').click();assert.equal(s.d.body.dataset.systemSection,'invoice');assert.equal(host.hidden,true);
 assert.equal(s.d.getElementById('note').value,'Conservar esta venta');
 }finally{s.dom.window.close()}
});


test('Caja se crea bajo demanda, reutiliza la sección y pausa consultas al salir',()=>{
 const s=setup();try{
 const content=s.d.getElementById('systemCajaContent');assert.equal(s.cajaModule,null);
 const arrow=s.d.getElementById('systemCajaExpand');arrow.click();assert.equal(arrow.getAttribute('aria-expanded'),'true');
 assert.equal(s.d.getElementById('systemCajaSubmenu').hidden,false);assert.equal(s.cajaModule,null);
 s.w.CorralonInvoiceSections.show('caja-additional');assert.equal(content.dataset.initialView,'adicionales');
 assert.equal(s.w.location.hash,'#caja/adicionales');assert.equal(s.d.getElementById('systemCaja').hidden,false);
 const calls=[],module=s.cajaModule;module.setActive=v=>calls.push(['active',v]);module.navigate=v=>calls.push(['view',v]);
 s.w.CorralonInvoiceSections.show('invoice');assert.deepEqual(calls.at(-1),['active',false]);
 s.w.CorralonInvoiceSections.show('caja-collections');assert.equal(s.cajaModule,module);assert.deepEqual(calls.slice(-2),[['active',true],['view','cobranzas']]);
 assert.equal(s.w.location.hash,'#caja/cobranzas');assert.equal(s.calls.length,0);
 module.canLeave=()=>false;assert.equal(s.w.CorralonInvoiceSections.show('invoice'),false);assert.equal(s.d.body.dataset.systemSection,'caja');
 }finally{s.w.close();}
});

test('Caja respeta permisos y Ctrl clic abre el destino sin cargar el módulo actual',()=>{
 const s=setup();try{
 const opened=[];s.w.open=(...args)=>opened.push(args);
 for(const [section,hash]of [['caja','#caja/diaria'],['caja-additional','#caja/adicionales'],['caja-collections','#caja/cobranzas']]){
 s.d.querySelector(`button[data-system-section="${section}"]`).dispatchEvent(new s.w.MouseEvent('click',{bubbles:true,ctrlKey:true}));
 assert.equal(new URL(opened.at(-1)[0]).hash,hash);
 }
 assert.equal(s.cajaModule,null);
 s.setAllowed(false);s.w.CorralonInvoiceSections.openMenu();assert.equal(s.d.querySelector('[data-system-caja-group]').hidden,true);
 assert.equal(s.w.CorralonInvoiceSections.show('caja'),false);
 }finally{s.w.close();}
});

test('las rutas de Caja actualizan título y atrás restaura la subsección',async()=>{
 const s=setup();try{
 s.w.CorralonInvoiceSections.show('caja');
 const calls=[];s.cajaModule.navigate=v=>calls.push(v);
 s.w.CorralonInvoiceSections.cajaRoute('cobranzas');assert.equal(s.w.location.hash,'#caja/cobranzas');
 assert.equal(s.d.querySelector('.topbar .brand b').textContent,'Cobranzas en caja');
 s.w.history.replaceState(null,'','#caja/adicionales');s.w.dispatchEvent(new s.w.PopStateEvent('popstate'));
 assert.equal(calls.at(-1),'adicionales');assert.equal(s.d.querySelector('.topbar .brand b').textContent,'Opciones adicionales');
 }finally{s.w.close();}
});
