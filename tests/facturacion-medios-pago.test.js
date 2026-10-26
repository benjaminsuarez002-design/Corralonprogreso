const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const requireDom = createRequire(path.join(__dirname, '..', '.codex-staging', 'importer-dom-test', 'package.json'));
const { JSDOM } = requireDom('jsdom');

test('configura comprobantes y tarjetas por medio, y Facturación rechaza combinaciones excluidas', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'configuracion.html'), 'utf8');
  const invoiceHtml = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
  const rulesCode = fs.readFileSync(path.join(__dirname, '..', 'facturacion-medios-pago.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><body><div id="paymentRuleList"></div><span id="mediosMessage"></span><dialog id="paymentRuleDialog"></dialog><h2 id="paymentRuleTitle"></h2><div id="paymentRuleVouchers"></div><fieldset id="paymentRuleCardsGroup"></fieldset><div id="paymentRuleCards"></div><span id="paymentRuleMessage"></span><button id="savePaymentRule"></button><select id="voucherType"><option value="2">Factura B</option><option value="13">PRES. ESPECIAL</option></select><div id="paymentBody"></div></body>', {url:'http://localhost:8080/configuracion.html'});
  const doc=dom.window.document;
  doc.querySelector('#paymentRuleDialog').showModal=()=>{};
  doc.querySelector('#paymentRuleDialog').close=()=>{};
  const bootstrap={ok:true,
    tiposPago:[{id:1,nombre:'Efectivo',clase:1},{id:5,nombre:'Mercado Pago',clase:5},{id:6,nombre:'Transf Bria.',clase:3}],
    comprobantesEmitibles:[2,13],comprobantes:[{id:2,codigo:'FB',nombre:'Factura B'},{id:13,codigo:'XVTAS',nombre:'PRES. ESPECIAL'}],
    tarjetas:[{id:3,nombre:'MP Credito'},{id:19,nombre:'MP Debito'},{id:22,nombre:'MP QR'},{id:4,nombre:'MP Transferencia'}]};
  let saved=null;
  const firestore=()=>({collection:()=>({doc:()=>({get:async()=>({exists:false}),set:async data=>{saved=data}})})});
  const context={window:dom.window,document:doc,console,structuredClone,CorralonMediosPago:null,
    paymentBootstrap:null,paymentRules:null,selectedPaymentId:0,
    firestore,fetch:async()=>({ok:true,json:async()=>bootstrap}),user:()=>({}),
    $:selector=>doc.querySelector(selector),$$:selector=>[...doc.querySelectorAll(selector)],
    escapeHtml:value=>String(value),setMessage:(selector,message)=>{doc.querySelector(selector).textContent=message}};
  vm.createContext(context);
  vm.runInContext(rulesCode,context);
  context.CorralonMediosPago=dom.window.CorralonMediosPago;
  const start=html.indexOf('const paymentTypes=');
  const end=html.indexOf('function bindRules(){',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(html.slice(start,end),context);
  await context.loadPaymentRules();
  context.openPaymentRule(5);
  assert.equal(doc.querySelectorAll('#paymentRuleVouchers input:checked').length,2);
  assert.equal(doc.querySelectorAll('#paymentRuleCards input:checked').length,3);
  assert.equal(doc.querySelector('[data-rule-card="4"]').checked,false);
  doc.querySelector('[data-rule-voucher="2"]').checked=false;
  doc.querySelector('[data-rule-card="4"]').checked=false;
  await context.savePaymentRule();
  assert.deepEqual(Array.from(saved.medios['5'].comprobantesExcluidos),[2]);
  assert.deepEqual(Array.from(saved.medios['5'].tarjetasExcluidas),[4]);
  context.openPaymentRule(1);
  assert.equal(doc.querySelector('#paymentRuleCardsGroup').hidden,true);
  context.openPaymentRule(6);
  assert.equal(doc.querySelectorAll('#paymentRuleCards input:checked').length,1);
  assert.equal(doc.querySelector('[data-rule-card="4"]').checked,true);

  const invoiceStart=invoiceHtml.indexOf('function paymentType(row){');
  const invoiceEnd=invoiceHtml.indexOf('function cardPlans(row){',invoiceStart);
  assert.ok(invoiceStart>=0&&invoiceEnd>invoiceStart);
  Object.assign(context,{sqlConfig:bootstrap,payments:[{tipo:'Mercado Pago',idTipoPago:5,importe:100,idTarjeta:3}],
    n:value=>Number(value)||0,norm:value=>String(value||'').toLowerCase().trim()});
  vm.runInContext(invoiceHtml.slice(invoiceStart,invoiceEnd),context);
  assert.deepEqual(Array.from(context.allowedPaymentTypes().map(x=>x.nombre)),['Efectivo','Transf Bria.']);
  assert.match(context.paymentRuleProblem().message,/no está permitido/);
  doc.querySelector('#voucherType').value='13';
  assert.equal(context.paymentRuleProblem(),null);
  context.payments[0].idTarjeta=4;
  assert.match(context.paymentRuleProblem().message,/no es compatible/);
  dom.window.close();
});
