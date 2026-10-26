const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const source=fs.readFileSync('respaldo/caja.html','utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixture={cabecera:{IDRecibo:24,NroFactura:'0005-00000224',Fecha:'2026-10-15',IDDepósito:5,PV:'PROGRESO 2',Nota:'<img src=x onerror=alert(1)>'},detalle:[{TipoPago:'Efectivo',ImpAnt:100,Importe:500,ImpRet:-200,ImpAct:400},{TipoPago:'Cta. Cte.',ImpAnt:0,Importe:60,ImpRet:0,ImpAct:60}],efectivo:[{Importe:-200,Nota:'Retiro',Hora:'12:56:00'}],tarjetas:[{Tarjeta:'MP Crédito',Importe:300}],ventas:[{ImpVta:600,ImpCosto:400}],cobros:[{TotCob:60}]};

test('reporte independiente con formato diario, importes firmados y texto escapado',()=>{
 const code=source.split('// INICIO INFORME DIARIO CAJA')[1].split('// FIN INFORME DIARIO CAJA')[0];
 const context={esc:escape,money:value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(value),dateOf:value=>String(value).slice(0,10)};
 vm.runInNewContext(code,context);const html=context.cajaDailyReportHtml(fixture),dom=new JSDOM(html);
 try{
  const d=dom.window.document;assert.match(d.querySelector('h1').textContent,/5-PROGRESO 2/);assert.match(d.body.textContent,/15\/10\/2026/);
  assert.deepEqual([...d.querySelectorAll('.values th')].map(x=>x.textContent),['Tipo de Valor','Imp. Inicial','Movs. Día','Ingr./Egr.','Saldo Final']);
  assert.match(d.querySelector('.values tfoot').textContent,/460,00/);assert.match(d.querySelector('.cash').textContent,/-.*200,00/);assert.match(d.querySelector('.cash').textContent,/12:56/);
  assert.match(d.querySelector('.receipts').textContent,/60,00/);assert.equal(d.querySelectorAll('button,input,textarea,script,img').length,0);
  assert.match(d.body.textContent,/<img src=x/);assert.match(html,/@page\{size:A4 portrait/);
 }finally{dom.window.close()}
});

test('consultar una caja solo lee y abre reporte sin reemplazar la caja ni el borrador actual',async()=>{
 const dom=new JSDOM('<input id="sqlCajaDate" value="2026-10-16"><textarea id="sqlCajaNote">Borrador sin guardar</textarea><div id="sqlCajaConsultStatus"></div><table><tbody id="sqlCajaConsultRows"><tr data-id="24"><td>Caja histórica</td></tr></tbody></table>');
 try{
  const d=dom.window.document,calls=[],active={cabecera:{IDRecibo:99}};let report;
  const context={$:id=>d.getElementById(id),current:active,load:()=>assert.fail('No debe cargar la caja principal'),render:()=>assert.fail('No debe reemplazar la caja principal'),CajaSQL:{request:async(action,params)=>{calls.push({action,params});return fixture}},showDailyReport:data=>report=data};
  const handler=source.match(/\$\('sqlCajaConsultRows'\)\.onclick = async event => \{[\s\S]*?\n  };/)[0];
  vm.runInNewContext('let reportLoading=false;'+handler,context);
  await d.getElementById('sqlCajaConsultRows').onclick({target:d.querySelector('td')});
  assert.equal(calls.length,1);assert.equal(calls[0].action,'formulario');assert.equal(calls[0].params.id,24);assert.equal(report,fixture);assert.equal(context.current,active);assert.equal(active.cabecera.IDRecibo,99);
  assert.equal(d.getElementById('sqlCajaDate').value,'2026-10-16');assert.equal(d.getElementById('sqlCajaNote').value,'Borrador sin guardar');
 }finally{dom.window.close()}
});

test('ofrece impresion solo despues de guardar y confirmar el cierre con exito',async()=>{
 const confirmButton={},note={value:'Cierre'},events=[];let fail=false;
 const context={$:id=>id==='sqlCajaConfirm'?confirmButton:note,run:fn=>fn(),confirm:()=>true,current:{cabecera:{IDRecibo:99},version:'version-original'},saveDetail:async()=>events.push('guardar'),CajaSQL:{request:async action=>{assert.equal(action,'cerrar');events.push('cerrar');if(fail)throw Error('Conflicto');return fixture}},render:data=>{assert.equal(data,fixture);events.push('mostrar')},localStorage:{setItem:()=>{}},showDailyReport:data=>{assert.equal(data,fixture);events.push('ofrecer impresion')}};
 vm.runInNewContext(source.match(/^  \$\('sqlCajaConfirm'\)\.onclick = .*$/m)[0],context);
 await confirmButton.onclick();assert.deepEqual(events,['guardar','cerrar','mostrar','ofrecer impresion']);
 fail=true;events.length=0;await assert.rejects(confirmButton.onclick(),/Conflicto/);assert.deepEqual(events,['guardar','cerrar']);
});

test('Imprimir solo existe en el popup y queda oculto e inactivo para cajas abiertas',()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost:8080/caja.html'}),w=dom.window;let prints=0;
 try{
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'))};
  const code=source.slice(source.indexOf('  const reportDialog=document.createElement'),source.indexOf('  function synchronizeDate()'));
  const context={document:w.document,$:id=>w.document.getElementById(id),cajaDailyReportHtml:()=>'<p>Reporte</p>'};vm.runInNewContext(code,context);
  const frame=w.document.getElementById('sqlCajaReportFrame'),button=w.document.getElementById('sqlCajaReportPrint');
  frame.contentWindow.focus=()=>{};frame.contentWindow.print=()=>prints++;
  context.showDailyReport({...fixture,cabecera:{...fixture.cabecera,Confirmado:false}});frame.onload();
  assert.equal(button.hidden,true);assert.equal(button.disabled,true);button.onclick();assert.equal(prints,0);
  context.showDailyReport({...fixture,cabecera:{...fixture.cabecera,Confirmado:true}});frame.onload();
  assert.equal(button.hidden,false);assert.equal(button.disabled,false);button.onclick();assert.equal(prints,1);
  context.showDailyReport({...fixture,cabecera:{...fixture.cabecera,Confirmado:false}});frame.onload();button.onclick();assert.equal(prints,1);
  assert.doesNotMatch(source,/id="sqlCajaPrint"/);
 }finally{w.close()}
});

test('solo cerrar el reporte del cierre vacía los datos, sin abrir otra Caja ni cambiar fecha o sucursal',()=>{
 const fields=['sqlCajaNumber','sqlCajaNote','sqlCajaInitial','sqlCajaDaily','sqlCajaIE','sqlCajaFinal','sqlCajaCashTotal','sqlCajaCardsTotal','sqlCajaSalesTotal','sqlCajaCostTotal','sqlCajaMargin','sqlCajaReceiptsTotal'];
 const tables=['sqlCajaValues','sqlCajaCash','sqlCajaCards','sqlCajaSales','sqlCajaDifferences'];
 const dom=new JSDOM('<body>'+fields.map(id=>`<input id="${id}" value="123">`).join('')+tables.map(id=>`<div id="${id}">Datos</div>`).join('')+'<span id="sqlCajaValueCount"></span><input id="sqlCajaDate" value="2026-10-17"><input id="sqlCajaDeposit" value="5"></body>');
 const w=dom.window;
 try{
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  const context={document:w.document,$:id=>w.document.getElementById(id),cajaDailyReportHtml:()=>'',sequence:0,cashSavedDraftKey:'draft',current:fixture,status:()=>{},lockControls:()=>{},render:data=>{context.current=data},CajaSQL:{request:()=>assert.fail('Vaciar no debe escribir SQL ni abrir una Caja')}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function clearClosedCajaForm(){'),source.indexOf('  async function load(id = 0)')),context);
  vm.runInContext(source.slice(source.indexOf('  const reportDialog=document.createElement'),source.indexOf('  function synchronizeDate()')),context);
  context.showDailyReport(fixture);w.document.getElementById('sqlCajaReportClose').click();assert.equal(context.current,fixture);assert.equal(context.$('sqlCajaNote').value,'123');
  context.showDailyReport(fixture,{resetOnClose:true});w.document.getElementById('sqlCajaReportClose').click();
  assert.equal(context.current.cabecera,undefined);for(const id of fields)assert.equal(context.$(id).value,'');for(const id of tables)assert.equal(context.$(id).innerHTML,'');
  assert.equal(context.$('sqlCajaDate').value,'2026-10-17');assert.equal(context.$('sqlCajaDeposit').value,'5');assert.equal(context.sequence,1);
 }finally{w.close()}
});
