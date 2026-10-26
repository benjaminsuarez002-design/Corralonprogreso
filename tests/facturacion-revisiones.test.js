const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','facturacion-revisiones.js'),'utf8');
function setup({network=true,print=true}={}){
  const storage=new Map(),events=[],panels=[];
  class Element{constructor(){this.children=[];this.status={textContent:''};}appendChild(el){this.children.push(el);return el;}insertAdjacentHTML(){}setAttribute(){}querySelector(){return this.status;}focus(){}remove(){this.removed=true;}}
  const document={head:new Element(),body:new Element(),readyState:'loading',createElement:()=>new Element(),addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null};
  const context=vm.createContext({window:{addEventListener(){},dispatchEvent(){}},document,Event:class{},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},structuredClone,URL,URLSearchParams,Intl,AbortController,setTimeout,clearTimeout,location:{origin:'http://localhost:8080',href:'http://localhost:8080/gestion.html',search:''},console:{warn(){}},setInterval(){},fetch:async(url,options)=>{events.push(['save',JSON.parse(options.body)]);if(!network)throw new Error('Sin conexión');return{ok:true,json:async()=>({ok:true})}}});
  vm.runInContext(source,context);
  const api=context.window.CorralonSaleReviews;
  api.configure({newId:()=> '11111111-1111-4111-8111-111111111111',archive:async(d,e)=>events.push(['archive',structuredClone(d)]),print:async(d,e)=>{events.push(['print',structuredClone(d),e.central]);if(!print)throw new Error('Impresora desconectada')},browserPending:()=>false,next:()=>events.push(['next'])});
  return{api,storage,events,document};
}
const sale={id:'original-sale-id',emision:{idRecibo:496894,numero:'0004-00038134',total:28000},cliente:{nombre:'FERNANDEZ'},totales:{total:7300},articulos:[{idart:'000840',cantidad:1,precio:2300}],valores:[{tipo:'Transferencia',importe:7300}]};
test('guarda antes de imprimir, elimina la asociación equivocada y permite otra venta',async()=>{
  const s=setup();await s.api.handle(sale,new Error('No coincide con SQL'));
  assert.deepEqual(s.events.map(e=>e[0]),['save','archive','print']);
  const ticket=s.events[2][1];assert.equal(ticket.emision,null);assert.equal(ticket.totales.total,7300);assert.equal(ticket.articulos[0].idart,'000840');assert.equal(sale.emision.total,28000);
  const panel=s.document.body.children[0].children[0],next=panel.children.find(x=>x.className==='primary');assert.ok(next);next.onclick();assert.equal(s.events.at(-1)[0],'next');
});
test('sin conexión conserva el detalle y deja el aviso pendiente de envío',async()=>{
  const s=setup({network:false});await s.api.handle(sale,new Error('Sin SQL'));
  const saved=JSON.parse(s.storage.get('corralon_ventas_revision_v1'));
  const entry=Object.values(saved)[0];assert.equal(entry.central,false);assert.equal(entry.data.totales.total,7300);assert.equal(s.events.find(e=>e[0]==='print')[2],false);
  assert.match(s.document.body.children[0].children[0].status.textContent,/aviso pendiente de conexión/);
});
test('una impresora caída deja la revisión y ofrece continuar sin afirmar que imprimió',async()=>{
  const s=setup({print:false});await s.api.handle(sale,new Error('Error de emisión'));
  const panel=s.document.body.children[0].children[0];assert.match(panel.status.textContent,/NO se pudo enviar el ticket/);assert.ok(panel.children.find(x=>x.className==='primary'));assert.ok(s.storage.has('corralon_ventas_revision_v1'));
});
test('el aviso global se habilita para todos los administradores por nivel',()=>{
 const s=setup();for(const [usuario,nivel,expected] of [['arturo','vendedor',false],['admin','administrador',true],['benja','administrador',true],['otro','administrador',true],['benja','vendedor',false]]){s.storage.set('corralon_menu_active_user_snapshot_v1',JSON.stringify({usuario,nivel}));assert.equal(s.api.isBenja(),expected);}
});
test('guardar pendiente envía revisión central y archiva sin imprimir',async()=>{const s=setup();await s.api.queue(sale,'Pendiente');assert.deepEqual(s.events.map(e=>e[0]),['save','archive']);});

test('la impresión pendiente usa su referencia de revisión y no consulta otra boleta',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','gestion.html'),'utf8');
  assert.ok(html.includes('receipt=source?.revisionPendiente?null:'));
  const flow=html.slice(html.indexOf('async function printReviewTicket('),html.indexOf('function configureSaleReviews('));assert.ok(flow.includes('NO ES FACTURA'));assert.ok(flow.includes('/imprimir-revision'));assert.ok(!flow.includes('idRecibo:'));
  assert.ok(html.includes('!d.revisionResuelta&&d.id!==draftId'));
});
test('sintaxis del script global',()=>new vm.Script(source));

test('el detalle abre Facturación en otra pestaña del servidor actual',()=>{const flow=source.slice(source.indexOf("open.textContent='Ver artículos y pagos'"),source.indexOf('const verify=document.createElement'));assert.ok(flow.includes('window.open'));assert.ok(flow.includes('revisionBorrador'));assert.ok(flow.includes("url.hash='facturacion'"));});

test('no crea revisión de un formulario vacío',async()=>{const s=setup();assert.equal(await s.api.handle({...sale,articulos:[]},new Error('No coincide')),false);assert.equal(s.events.length,0);await assert.rejects(s.api.queue({...sale,articulos:[]},'Pendiente'),/borrador está vacío/);assert.equal(s.events.length,0);});

test('administrador consulta ARCA y SQL con el borrador original sin emitir',()=>{const flow=source.slice(source.indexOf("verify.textContent='Consultar ARCA y SQL'"),source.indexOf("const find=document.createElement('button');find.textContent='Buscar venta realizada'"));assert.ok(flow.includes('id:sale.id'));assert.ok(flow.includes("consultarArca:'1'"));assert.ok(flow.includes('statusView(detail,state'));assert.ok(!flow.includes('/emitir'));});
