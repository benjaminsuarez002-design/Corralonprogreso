const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('gestion.html','utf8');
function setup(overrides={}){
 const fields={voucherType:{value:'2'},customerName:{value:'CLIENTE ESCRITO',dataset:{idCliente:'1'}},customerTax:{value:'Consumidor final'},docType:{value:'DNI'},docNumber:{value:''}};
 for(const [id,props] of Object.entries(overrides))Object.assign(fields[id],props);
 const ctx={$:selector=>fields[selector.slice(1)],issuedReceipt:null,recoveryPending:false,norm:x=>String(x||'').toLowerCase().trim()};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function completeGenericConsumerDocument(){'),html.indexOf('function formData(){')),ctx);
 return{fields,ctx};
}
test('B genérica completa solo el documento vacío y conserva nombre, cliente y condición de IVA',()=>{
 const s=setup();assert.equal(s.ctx.completeGenericConsumerDocument(),true);assert.equal(s.fields.docNumber.value,'00001000000');assert.equal(s.fields.docType.value,'DNI');assert.equal(s.fields.customerName.value,'CLIENTE ESCRITO');assert.equal(s.fields.customerName.dataset.idCliente,'1');assert.equal(s.fields.customerTax.value,'Consumidor final');assert.equal(s.ctx.completeGenericConsumerDocument(),false);
});
test('documento Sin identificar vacío completa el genérico local al preparar la factura B',()=>{
 const s=setup({docType:{value:'Sin identificar'},docNumber:{value:'  '}});assert.equal(s.ctx.completeGenericConsumerDocument(),true);assert.equal(s.fields.docType.value,'DNI');assert.equal(s.fields.docNumber.value,'00001000000');
});
test('no reemplaza documentos reales ni CUIT vacíos; no toca clientes registrados, exentos ni otros comprobantes',()=>{
 for(const override of [{docNumber:{value:'40367963'}},{docType:{value:'CUIT'}},{customerName:{dataset:{idCliente:'10690'}}},{customerTax:{value:'Exento'}},{voucherType:{value:'1'}},{voucherType:{value:'13'}}]){
  const s=setup(override),before=JSON.stringify(s.fields);assert.equal(s.ctx.completeGenericConsumerDocument(),false);assert.equal(JSON.stringify(s.fields),before);
 }
});
test('no modifica una venta emitida ni una pendiente de recuperación',()=>{
 for(const property of ['issuedReceipt','recoveryPending']){const s=setup();s.ctx[property]=true;assert.equal(s.ctx.completeGenericConsumerDocument(),false);assert.equal(s.fields.docNumber.value,'');}
});
test('se completa al salir del campo y antes de bloquear/preparar el nuevo envío, sin alterar el contrato fiscal',()=>{
 const issue=html.slice(html.indexOf('async function issue(){'),html.indexOf('async function issue(){')+15000);
 assert.ok(issue.indexOf('completeGenericConsumerDocument();')<issue.indexOf('issueInProgress=true;'));
 assert.match(html,/\$\('#docNumber'\)\.addEventListener\('blur',\(\)=>\{if\(completeGenericConsumerDocument\(\)\)scheduleDraft\(\);\}\);/);
 const api=fs.readFileSync('facturacion-copia-api.cs','utf8');assert.match(api,/customer == 1 && docId == 50 && \(doc.Length == 0 \|\| doc == "00000001000" \|\| doc == "00001000000"\)\) \{ docId = 32; doc = ""; \}/);
});

test('bloquea documentos con letras sin convertirlos silenciosamente a números',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function billingDocumentError('),html.indexOf('async function issue(){')),ctx);
 for(const value of ['f4287197','42f87197','42 87197'])assert.match(ctx.billingDocumentError('DNI',value),/Documento inválido/);
 assert.equal(ctx.billingDocumentError('DNI','4287197'),'');
 assert.equal(ctx.billingDocumentError('CUIT','20-36911157-4'),'');
 assert.match(ctx.billingDocumentError('CUIT','123'),/11 números/);
});
