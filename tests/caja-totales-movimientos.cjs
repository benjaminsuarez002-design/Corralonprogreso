const fs=require('fs'),vm=require('vm'),assert=require('assert');
const text=fs.readFileSync('caja-ingresos-historial.js','utf8');
new vm.Script(text);
const code=text.slice(text.indexOf('function totalsForDate'),text.indexOf('function totalRowCells'));
const key=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const context={selectedDateKey:'2026-10-01',state:{},localStorage:{getItem:()=>null},storageKeyForDate:d=>d,
  cajaRestricted:false,CAJA_ALL_BRANCHES_ID:'all',CAJA_GLOBAL_ONLY_BRANCH_ID:'global',
  cashMovementBranches:()=>[{id:'progreso_ruta',label:'Progreso'},{id:'calle5_espana',label:'Calle 5'}],
  movementTypeKey:key,receiptRowsFromPayload:p=>p};
vm.runInNewContext(code,context);
const movement=(type,day)=>({type,day,initial:99999,ie:-88888});
const cached={movimientos:{branches:{progreso_ruta:[movement('Efectivo',3985763.51),movement('Cheques',1750000),movement('Banco santander',1898292.87),movement('Cta. Cte.',376844.47),movement('Vale',123)]}},ingresosEgresos:[{amount:-2000000}]};
const result=context.totalsForDate('2026-10-01',cached)[0];
assert.equal(result.cash,3985763.51);assert.equal(result.checks,1750000);assert.equal(result.santander,1898292.87);
assert.equal(result.accountCredit,376844.47);assert.equal(result.vouchers,123);
assert(Math.abs(result.daily-(3985763.51+1750000+1898292.87))<0.001);
const receipts={movimientos:{branches:{progreso_ruta:[movement('Efectivo',100)],calle5_espana:[movement('Efectivo',50)]},globalOnlyRows:[movement('Efectivo',30)]},recibos:[{branchId:'calle5_espana',payments:[{type:'Efectivo',amount:30}]}]};
const totals=context.totalsForDate('2026-10-01',receipts);
assert.equal(totals.find(r=>r.branchId==='calle5_espana').cash,80);
assert.equal(totals.reduce((sum,r)=>sum+r.cash,0),180);
context.cajaRestricted=true;context.cajaRestrictedBranchId='calle5_espana';
const restricted=context.totalsForDate('2026-10-01',receipts);assert.equal(restricted.length,1);assert.equal(restricted[0].cash,80);
console.log('PASS: Movs. Dia sin caja inicial/egresos; Cheques y Santander; Cta. Cte./Vales aparte; recibos sin duplicar; filtro sucursal');
