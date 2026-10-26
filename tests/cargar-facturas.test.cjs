const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const formHtml = fs.readFileSync('respaldo/cargar-facturas.html', 'utf8');
const source = formHtml.match(/<script id="cargar-facturas-script">([\s\S]*?)<\/script>/)[1];
new vm.Script(source);
const shared = fs.readFileSync('funciones.js', 'utf8');
function sharedFunction(name) {
  const start = shared.indexOf(`  function ${name}(`);
  const end = shared.indexOf('\n  function ', start + 10);
  return shared.slice(start, end);
}
const fxContext = vm.createContext({});
for (const name of ['parseFechaFlexible','parseLocaleNumber','formatLocaleNumber','formatCurrencyText','formatComprobanteNumber']) vm.runInContext(sharedFunction(name), fxContext);
const FX = Object.fromEntries(['parseFechaFlexible','parseLocaleNumber','formatLocaleNumber','formatCurrencyText','formatComprobanteNumber'].map(name => [name, fxContext[name]]));
FX.menuUserHasAccess = () => true;
const optionData = {
  ok:true,
  tipos: [{ id:21,codigo:'ACOMM',nombre:'Factura A',libroIva:true,discrimina:true,automatico:false }],
  proveedores: [{ id:13,nombre:'BARCELO',cuit:'33-70833259-9',cuenta:'30',suspendido:false }],
  cuentas:[{id:'30',nombre:'Mercadería',empresa:1}], pagos:[{id:1,nombre:'Efectivo'},{id:3,nombre:'Cta. Cte.'}],
  bienes:[{id:2,nombre:'Bienes de Uso'}], impuestos:[{id:0,nombre:'Neto',porcentaje:0},{id:1,nombre:'IVA 21%',porcentaje:.21,codigoIva:'0005'}],
  puntosVenta:[{id:7,nombre:'Progreso',empresa:1,sucursal:1}]
};
function setup(saved) {
  const nodes = new Map(), stored = new Map(), requests = [];
  const actor = { id:'ana',nombre:'Ana' };
  if (saved) stored.set('corralon_cargar_facturas_borrador_v1:ana', JSON.stringify(saved));
  let postResult;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id,{value:'',textContent:'',checked:false,disabled:false,open:false,style:{},classList:{toggle(){},add(){},remove(){}},focus(){},showModal(){this.open=true},get innerHTML(){return this.html||''},set innerHTML(value){this.html=value;const first=/<option value="([^"]*)"/.exec(value);if(first)this.value=first[1];}});
    return nodes.get(id);
  };
  const context = vm.createContext({
    window:{CorralonFunciones:FX,confirm:()=>true,innerWidth:1024,innerHeight:768},document:{getElementById:node,activeElement:null,body:{appendChild(item){item.parentNode=this;}}},Event,
    localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},
    crypto:{randomUUID},URL,location:{href:'http://localhost:8080/cargar-facturas.html'},Intl,console,
    fetch:async (url,init) => {
      const body=init?.body?JSON.parse(init.body):null;requests.push({url:String(url),body});
      if(body){if(postResult instanceof Error)throw postResult;return postResult;}
      return {ok:true,status:200,json:async()=>url.searchParams.get('consulta')==='opciones'?structuredClone(optionData):{ok:true,movimientos:[]}};
    }
  });
  const body=source.slice(source.indexOf("  const $ ="),source.indexOf("  $('todayLabel').textContent"));
  vm.runInContext(body+`\n globalThis.purchase={initialize,confirmationPayload,confirmPurchase,saveDraft,parseFieldDate,parsePeriod,resetDraft,fillCombo,comboId,setComboValue,applyTaxChoice,purchaseComboItems,showPurchaseCombo,hidePurchaseCombo,movePurchaseCombo,pickPurchaseCombo,getCombo:()=>purchaseCombo,setRows:value=>{rows=value},getRows:()=>rows,getDraft:()=>draft};`,context);
  return {context,node,stored,requests,actor,setPost:value=>{postResult=value;}};
}
test('usa el parseo compartido de fechas y conserva el borrador por usuario',async()=>{
  const s=setup();await s.context.purchase.initialize(s.actor);
  s.node('provider').value='BARCELO · 13';s.node('date').value='5/10/2026';s.node('period').value='10/2026';s.node('due').value='4/11/2026';
  s.node('account').value='30';s.node('number').value='25-29222';s.node('discount').value='15';
  s.context.purchase.setRows([{key:'r1',impuesto:0,neto:1,importe:1000,porcentaje:.21,descripcion:'NETO'}]);
  const payload=s.context.purchase.confirmationPayload();
  assert.equal(payload.fecha,'2026-10-05');assert.equal(payload.periodo,'2026-10-01');assert.equal(payload.numero,'0025-00029222');assert.equal(payload.descuento,.15);
  s.context.purchase.saveDraft();assert(s.stored.has('corralon_cargar_facturas_borrador_v1:ana'));
  assert(s.requests.every(request=>!request.body),'Abrir/cargar no confirma compras');
});
test('restaurar una confirmación pendiente conserva la solicitud y bloquea descartar',async()=>{
  const pending={id:'draft-original',numero:'0001-00000001',proveedor:13};
  const saved={id:'draft-original',pending,fields:{date:'5/10/2026',point:'7',type:'21',provider:'BARCELO · 13',account:'30'},rows:[],inStock:false};
  const s=setup(saved);await s.context.purchase.initialize(s.actor);
  assert.equal(s.context.purchase.getDraft().pending.id,'draft-original');assert.equal(s.node('cancel').disabled,true);
  assert.equal(JSON.parse(s.stored.get('corralon_cargar_facturas_borrador_v1:ana')).pending.id,'draft-original');
});
test('una respuesta perdida mantiene el GUID y el contenido exacto para reintentar',async()=>{
  const pending={id:'draft-original',numero:'0001-00000001',proveedor:13};
  const s=setup({id:pending.id,pending,fields:{},rows:[],inStock:false});await s.context.purchase.initialize(s.actor);
  s.setPost(new Error('sin red'));await s.context.purchase.confirmPurchase();await s.context.purchase.confirmPurchase();
  const sends=s.requests.filter(request=>request.body);assert.equal(sends.length,2);assert.equal(sends[0].body.id,sends[1].body.id);
  assert.deepEqual(sends[0].body,sends[1].body);assert.equal(s.node('new').disabled,true);
  assert.equal(s.node('confirm').textContent,'Reintentar confirmación');
});
test('un rechazo confirmado por el servidor permite corregir sin borrar el borrador',async()=>{
  const pending={id:'draft-original',numero:'0001-00000001',proveedor:13};
  const s=setup({id:pending.id,pending,fields:{},rows:[],inStock:false});await s.context.purchase.initialize(s.actor);
  s.setPost({ok:false,status:409,json:async()=>({ok:false,error:'CUIT no válido'})});await s.context.purchase.confirmPurchase();
  assert.equal(s.context.purchase.getDraft().id,'draft-original');assert.equal(s.context.purchase.getDraft().pending,undefined);
  assert.equal(s.node('purchaseFields').disabled,false);
});
test('el nuevo permiso está en el menú, Usuarios y el guard; usa el tema compartido',()=>{
  for(const file of ['menu.html','usuarios.html','menu-auth-guard.js'])assert(fs.readFileSync(file,'utf8').includes('cargar_facturas'));
  const html=fs.readFileSync('respaldo/cargar-facturas.html','utf8');assert.match(html,/href="theme-corralon.css"/);assert.match(html,/data-menu-guard="cargar_facturas"/);
  assert.match(html,/<style id="cargar-facturas-styles">/);assert.match(html,/<script id="cargar-facturas-script">/);
  assert.doesNotMatch(html,/(?:src|href)="cargar-facturas\.(?:js|css)"/);
  const api=fs.readFileSync('facturacion-copia-api.cs','utf8');assert.match(api,/AssertPurchasePermission\(Text\(Value\(data, "usuarioId"\)\)\)/);assert.match(api,/CHARINDEX\(@p0,CONVERT\(nvarchar\(max\),Nota\)\)>0/);
});

test('los campos de texto restauran IDs anteriores y envían los IDs SQL de los nombres elegidos',async()=>{
  const s=setup({id:'borrador-anterior',fields:{type:'21',account:'30',payment:'3',point:'7'},rows:[],inStock:false});
  await s.context.purchase.initialize(s.actor);
  assert.equal(s.node('type').value,'ACOMM');assert.equal(s.node('account').value,'Mercadería · 30');assert.equal(s.node('payment').value,'Cta. Cte.');
  s.node('provider').value='BARCELO · 13';s.node('number').value='0001-00000001';
  s.node('account').value='mercaderia';s.node('payment').value='efectivo';
  s.context.purchase.setRows([{key:'r1',impuesto:0,neto:1,importe:1000,porcentaje:.21,descripcion:'NETO'}]);
  const payload=s.context.purchase.confirmationPayload();
  assert.equal(payload.tipo,21);assert.equal(payload.cuenta,'30');assert.equal(payload.pago,1);
  assert(s.requests.every(request=>!request.body));
});

test('rechaza textos fuera de las listas y distingue número de movimiento de su ID interno',async()=>{
  const s=setup();await s.context.purchase.initialize(s.actor);
  for(const id of ['type','account','payment']){
    const previous=s.node(id).value;s.node(id).value='NO EXISTE';
    assert.throws(()=>s.context.purchase.comboId(id,true),/lista SQL/);s.node(id).value=previous;
  }
  s.context.purchase.fillCombo('movement',[{id:900,numero:100,fecha:'5/10/2026',total:100},{id:100,numero:200,fecha:'5/10/2026',total:200}]);
  s.node('movement').value='100';assert.equal(s.context.purchase.comboId('movement',true),900);
  s.context.purchase.setComboValue('movement',100);assert.match(s.node('movement').value,/^200 ·/);assert.equal(s.context.purchase.comboId('movement',true),100);
  s.node('movement').value='movimiento inexistente';assert.throws(()=>s.context.purchase.comboId('movement',true),/lista SQL/);
});

test('elegir el impuesto por texto calcula IVA y un texto inválido no guarda el impuesto anterior',async()=>{
  const s=setup();await s.context.purchase.initialize(s.actor);
  const net={key:'net',impuesto:0,neto:1,importe:1000,porcentaje:.21,descripcion:'NETO'};
  const tax={key:'tax',impuesto:0,neto:1,importe:0,porcentaje:.21,descripcion:'NETO'};
  s.context.purchase.setRows([net,tax]);
  const cell={dataset:{row:'tax'},querySelector:selector=>s.node(selector)};
  const input={value:'iva 21%',closest:()=>cell};s.context.purchase.applyTaxChoice(input,true);
  assert.equal(tax.impuesto,1);assert.equal(tax.importe,210);assert.equal(input.value,'IVA 21%');
  input.value='impuesto desconocido';s.context.purchase.applyTaxChoice(input);assert.equal(tax.invalidTax,true);
  s.node('provider').value='BARCELO · 13';s.node('account').value='30';
  assert.throws(()=>s.context.purchase.confirmationPayload(),/impuesto de cada renglón/);
  input.value='IVA 21%';s.context.purchase.applyTaxChoice(input,true);assert.equal(tax.invalidTax,undefined);
  const html=fs.readFileSync('respaldo/cargar-facturas.html','utf8');assert.match(html,/<th class="secondary-tax" hidden/);
  assert.match(source,/<td class="secondary-tax" hidden[\s\S]*?<select data-generate tabindex="-1">/);
});

test('la lista conserva todas las opciones aunque se escriba texto y distingue código, descripción y valor',async()=>{
  const s=setup();await s.context.purchase.initialize(s.actor);
  const input={dataset:{sqlList:'payment'},value:'Efectivo'};
  const before=s.context.purchase.purchaseComboItems(input);input.value='texto que no coincide';
  const after=s.context.purchase.purchaseComboItems(input);assert.equal(after.length,2);assert.deepEqual(after,before);
  assert.equal(after[0].code,1);assert.equal(after[0].text,'Efectivo');
  input.dataset.sqlList='tax';assert.equal(s.context.purchase.purchaseComboItems(input).length,2);
  input.dataset.sqlList='provider';assert.equal(s.context.purchase.purchaseComboItems(input)[0].value,'BARCELO · 13');
  const native={dataset:{},value:'dato inexistente',options:[{value:'2',textContent:'Bienes de Uso'},{value:'1',textContent:'Mercadería'}]};
  assert.equal(s.context.purchase.purchaseComboItems(native).length,2);
  assert.doesNotMatch(formHtml,/<datalist\b|\blist="(?:type|account|payment|movement|tax|provider)Options"/);
});

test('el desplegable permite desplazarse y seleccionar, dispara los cambios una vez y se cierra',async()=>{
  const s=setup();await s.context.purchase.initialize(s.actor);
  const input=s.node('payment'),events=[],attributes={};
  const wrap={classList:{add(){},remove(){}}};
  Object.assign(input,{dataset:{sqlList:'payment'},matches:()=>false,closest:selector=>selector==='dialog'?null:wrap,
    setAttribute:(key,value)=>attributes[key]=value,removeAttribute:key=>delete attributes[key],
    getBoundingClientRect:()=>({left:300,top:130,bottom:152,width:150}),dispatchEvent:event=>events.push(event.type)});
  const menu=s.node('purchaseComboMenu');menu.querySelectorAll=()=>[];menu.querySelector=()=>null;
  s.context.purchase.showPurchaseCombo(input);assert.equal(attributes['aria-expanded'],'true');assert.equal(s.context.purchase.getCombo().items.length,2);
  input.value='texto inexistente';s.context.purchase.showPurchaseCombo(input);assert.equal(s.context.purchase.getCombo().items.length,2);
  s.context.purchase.movePurchaseCombo(1);assert.equal(s.context.purchase.pickPurchaseCombo(),true);
  assert.equal(input.value,'Cta. Cte.');assert.equal(s.context.purchase.comboId('payment',true),3);
  assert.deepEqual(events,['input','change']);assert.equal(attributes['aria-expanded'],'false');assert.equal(s.context.purchase.getCombo().input,null);
});

test('escribir marca y desplaza hasta la coincidencia sin filtrar ni seleccionar el proveedor',async()=>{
  const s=setup();await s.context.purchase.initialize(s.actor);
  const providers=Array.from({length:12},(_,index)=>({id:100+index,nombre:index===9?'ENZOMAC Materiales':'ABC '+index,cuit:'30-'+index}));
  s.context.purchase.fillCombo('provider',providers);
  const input=s.node('provider'),attributes={},events=[],wrap={classList:{add(){},remove(){}}};
  Object.assign(input,{dataset:{sqlList:'provider'},matches:()=>false,closest:selector=>selector==='dialog'?null:wrap,
    setAttribute:(key,value)=>attributes[key]=value,removeAttribute:key=>delete attributes[key],
    getBoundingClientRect:()=>({left:90,top:26,bottom:48,width:220}),dispatchEvent:event=>events.push(event.type)});
  const options=providers.map((_,index)=>({id:'purchase-combo-option-'+index,dataset:{purchaseOption:String(index)},
    offsetTop:index*31,offsetHeight:31,active:false,attributes:{},
    classList:{toggle(name,value){options[index].active=value;}},setAttribute(key,value){this.attributes[key]=value;}}));
  const menu=s.node('purchaseComboMenu');menu.scrollTop=0;menu.clientHeight=93;
  menu.querySelectorAll=()=>options;
  menu.querySelector=selector=>options[Number(selector.match(/"(\d+)"/)[1])];
  for(const query of ['enzomac','EnZóMaC','materiales','109','30-9']){
    input.value=query;s.context.purchase.showPurchaseCombo(input);
    assert.equal(s.context.purchase.getCombo().active,9);
    assert.equal(s.context.purchase.getCombo().items.length,providers.length);
    assert.equal(options[9].active,true);assert.equal(options[9].attributes['aria-selected'],'true');
    assert.equal(attributes['aria-activedescendant'],'purchase-combo-option-9');
    assert(menu.scrollTop<=options[9].offsetTop);
    assert(menu.scrollTop+menu.clientHeight>=options[9].offsetTop+options[9].offsetHeight);
    assert.equal(input.value,query);
  }
  assert.deepEqual(events,[]);assert(s.requests.every(request=>!request.body));
  input.value='sin coincidencia';s.context.purchase.showPurchaseCombo(input);
  assert.equal(s.context.purchase.getCombo().active,0);assert.equal(menu.scrollTop,0);
  assert.equal(options[9].active,false);
});
