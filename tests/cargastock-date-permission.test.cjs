const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../respaldo/cargastock.html'),'utf8');
function fixture(level){
 const field={value:'2026-09-01',readOnly:true,tabIndex:-1};
 const box={FX:{menuSessionUser:()=>({nivel:level})},stockField:()=>field,stockToday:()=> '2026-10-08',stockConfirmed:false,stockIngresoBusy:false,stockWorkspaceSwitching:false};
 vm.createContext(box);
 const shared=fs.readFileSync(path.join(__dirname,'../funciones.js'),'utf8');
 vm.runInContext(shared.slice(shared.indexOf('  function parseFechaFlexible('),shared.indexOf('  function bindDropdownOnlyWhenTyping('))+'\nFX.parseFechaFlexible=parseFechaFlexible;',box);
 const start=html.indexOf('function stockCanEditDate()'),end=html.indexOf('function stockHeaderSave()',start);
 vm.runInContext(html.slice(start,end),box);return {box,field};
}
test('solo administrador puede conservar y editar una fecha anterior',()=>{
 const admin=fixture('administrador');admin.box.stockDatePermission();assert.equal(admin.field.readOnly,false);assert.equal(admin.field.value,'01/09/2026');assert.equal(admin.field.max,'2026-10-08');
 const user=fixture('vendedor');user.box.stockDatePermission();assert.equal(user.field.readOnly,true);assert.equal(user.field.tabIndex,-1);assert.equal(user.field.value,'08/10/2026');
});
test('una carga confirmada conserva su fecha y no permite editarla',()=>{
 for(const level of ['administrador','vendedor']){const f=fixture(level);f.box.stockConfirmed=true;f.box.stockDatePermission();assert.equal(f.field.readOnly,true);assert.equal(f.field.value,'01/09/2026');}
});
test('las fechas cortas se normalizan y una fecha inexistente no se convierte',()=>{
 const {box}=fixture('administrador');
 assert.equal(box.stockDateText('1-9-26'),'01/09/2026');
 assert.equal(box.stockDateText('2026-09-01'),'01/09/2026');
 assert.equal(box.FX.parseFechaFlexible('31/02/2026'),null);
});
