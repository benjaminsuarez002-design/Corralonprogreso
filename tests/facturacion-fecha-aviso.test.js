const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','gestion.html'),'utf8');
const start=html.indexOf('function invoiceDateWarning('),end=html.indexOf("$('#date').value=today();",start);
function setup(value,answer=true,admin=true){
  const calls=[],field={value,focus:()=>calls.push('focus')};
  const context=vm.createContext({$:()=>field,today:()=> '2026-10-02',canBackdateInvoice:()=>admin,invoiceDatePermissionMessage:()=> 'Solo los administradores pueden emitir con fecha anterior.',invoiceDateAllowed:v=>v>='2026-09-27'&&v<='2026-10-02',confirm:message=>{calls.push(message);return answer},alert:message=>calls.push(message),setMsg:()=>{},saveDraft:()=>{calls.push('save');return Promise.resolve()},console});
  vm.runInContext(html.slice(start,end),context);return{context,calls,field};
}
test('al abrir un borrador de ayer permite conservar la fecha intencionalmente',()=>{const s=setup('2026-10-01');s.context.reviewInvoiceDateOnOpen();assert.equal(s.field.value,'2026-10-01');assert.match(s.calls[0],/Fecha inválida/);assert.match(s.calls[0],/01\/10\/2026/)});
test('si rechaza la fecha anterior al abrir cambia a hoy y guarda el borrador',()=>{const s=setup('2026-10-01',false);s.context.reviewInvoiceDateOnOpen();assert.equal(s.field.value,'2026-10-02');assert.ok(s.calls.includes('save'))});
test('comprueba nuevamente antes de confirmar aunque haya aceptado al abrir',()=>{const s=setup('2026-09-27');s.context.reviewInvoiceDateOnOpen();assert.equal(s.context.confirmInvoiceDate(),true);assert.equal(s.calls.length,2)});
test('cancelar el aviso al confirmar conserva la venta y enfoca la fecha',()=>{const s=setup('2026-10-01',false);assert.equal(s.context.confirmInvoiceDate(),false);assert.equal(s.field.value,'2026-10-01');assert.ok(s.calls.includes('focus'));assert.ok(!s.calls.includes('save'))});
test('la fecha de hoy no genera avisos',()=>{const s=setup('2026-10-02');s.context.reviewInvoiceDateOnOpen();assert.equal(s.context.confirmInvoiceDate(),true);assert.equal(s.calls.length,0)});
test('el borrador fuera del rango permitido se abre con fecha actual',()=>{const s=setup('2026-09-20');s.context.reviewInvoiceDateOnOpen();assert.equal(s.field.value,'2026-10-02');assert.match(s.calls[0],/fuera del período/)});
test('un usuario sin rango administrador abre el borrador con fecha de hoy',()=>{const s=setup('2026-10-01',true,false);s.context.reviewInvoiceDateOnOpen();assert.equal(s.field.value,'2026-10-02');assert.match(s.calls[0],/Solo los administradores/);assert.ok(s.calls.includes('save'))});
test('un usuario común no puede aceptar el aviso para emitir con fecha anterior',()=>{const s=setup('2026-10-01',true,false);assert.equal(s.context.confirmInvoiceDate(),false);assert.match(s.calls[0],/Solo los administradores/);assert.ok(s.calls.includes('focus'))});
test('el calendario permite cinco días solo con nivel administrador',()=>{
  const from=html.indexOf('function updateInvoiceDateLimits('),to=html.indexOf('function invoiceDateWarning(',from),field={checkValidity:()=>true};let nivel='administrador';
  const context=vm.createContext({$:()=>field,today:()=> '2026-10-02',uid:()=>({nivel}),Date});vm.runInContext(html.slice(from,to),context);
  context.updateInvoiceDateLimits();assert.equal(field.min,'2026-09-27');assert.equal(context.invoiceDateAllowed('2026-10-01'),true);
  for(nivel of ['vendedor','personalizado','',undefined]){context.updateInvoiceDateLimits();assert.equal(field.min,'2026-10-02');assert.equal(context.invoiceDateAllowed('2026-10-01'),false);assert.equal(context.invoiceDateAllowed('2026-10-02'),true)}
});
