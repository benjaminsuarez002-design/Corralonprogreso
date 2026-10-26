const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','gestion.html'),'utf8');
const start=html.indexOf('function updatePaymentAdjustment(row,source){');
const end=html.indexOf('function renderPayments(){',start);
const context={n:value=>Number(value)||0,roundMoney:value=>Math.round((value+Number.EPSILON)*100)/100};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..','facturacion-medios-pago.js'),'utf8'),context);vm.runInContext(html.slice(start,end),context);
test('editar Total conserva importe y calcula descuento o recargo',()=>{
  for(const [total,fee,coef] of [[9500,-500,-.05],[10300,300,.03],[0,-10000,-1]]){
    const row={importe:10000,impRec:0,coef:0,total};context.updatePaymentAdjustment(row,'total');
    assert.equal(row.importe,10000);assert.equal(row.impRec,fee);assert.equal(row.coef,coef);
    assert.equal(row.importe+row.impRec,total);assert.equal('total'in row,false);
    assert.equal(context.roundMoney(row.importe*row.coef),row.impRec,'SQL receives consistent adjustment');
  }
});
test('sin importe inicial, Total inicia el monto sin inventar porcentaje',()=>{
  const row={importe:0,total:2500};context.updatePaymentAdjustment(row,'total');
  assert.equal(row.importe,2500);assert.equal(row.impRec,0);assert.equal(row.coef,0);
});
test('Total admite funciones monetarias y navegación de la fila',()=>{
  assert.match(html,/data-money data-p="total" data-payment-total="\$\{i\}" data-row="\$\{i\}" data-col="7" inputmode="decimal"/);
  assert.ok(!html.includes('data-payment-total="${i}" data-col="7" value="${money(n(r.importe)+n(r.impRec))}" readonly'));
});
