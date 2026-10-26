const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const requireDom = createRequire(path.join(__dirname, '..', '.codex-staging', 'importer-dom-test', 'package.json'));
const { JSDOM } = requireDom('jsdom');

test('el menú de cliente permite dar de alta y volver a abrir la ficha desde SQL', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
  const start = html.indexOf('let customerBalanceState=');
  const end = html.indexOf('function syncPaymentTableFromDom(){', start);
  assert.ok(start >= 0 && end > start);
  const dom = new JSDOM(html, { url:'http://localhost:8080/gestion.html', runScripts:'outside-only' });
  const $ = selector => dom.window.document.querySelector(selector);
  $('#customerName').dataset.idCliente = '1';
  let saved = null, getCount = 0;
  const cliente = { id:15000, nombre:'CLIENTE PRUEBA', documento:'12345678', idTipoDoc:96, idTipoIva:5,
    direccion:'Calle 123', telefono:'123456', email:'', saldoSql:0, cupoDisponible:880,
    idLista:3, idVendedor:1, idTipoPago:1, limiteCredito:1000, descuento:0 };
  const context = {
    document:dom.window.document, window:dom.window, innerWidth:1200, innerHeight:800, console,
    SQL_PREPARACION:'/api/facturacion', $, $$:selector=>[...dom.window.document.querySelectorAll(selector)], n:value=>Number(value)||0, norm:value=>String(value||'').toLowerCase().trim(),
    money:value=>`$ ${Number(value).toFixed(2)}`, roundMoney:value=>Math.round(value*100)/100, esc:value=>String(value||''), scheduleDraft(){},
    syncCustomerTaxShort(){}, setMsg(){}, loadSqlCustomers:async()=>{},
    sqlConfig:{ clientesEdicion:true, listas:[{id:3,nombre:'Minorista'}], tiposIva:[{id:5,nombre:'Consumidor final'}],
      tiposDocumento:[{id:96,nombre:'DNI'},{id:67,nombre:'CUIT'}], vendedores:[{id:1,nombre:'Benjamin'}],
      tiposPago:[{id:1,nombre:'Efectivo'}] },
    fetch:async(url,options={})=>{
      if(options.method==='POST'){ saved=JSON.parse(options.body); return {ok:true,json:async()=>({ok:true,cliente})} }
      if(String(url).includes('opciones=1'))return {ok:true,json:async()=>({ok:true,departamentos:[],provincias:[],regiones:[],tiposIb:[],tiposComercio:[{id:1,nombre:'General'}]})};
      getCount++; return {ok:true,json:async()=>({ok:true,cliente})};
    }
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start,end),context);
  assert.equal(context.customerCurrentBalance({saldoSql:0,limiteCredito:400000,cupoDisponible:269800}),130200);
  assert.equal(context.customerCurrentBalance({saldoSql:0,limiteCredito:1000,cupoDisponible:1250}),-250);
  assert.equal(context.customerCurrentBalance({saldoSql:0,limiteCredito:1000}),null);
  context.bindCustomerEditor();
  assert.equal($('#editCustomerDocument').required,true);
  context.sqlConfig.clientesEdicion=false;
  const oldApiClick=new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20});
  $('#customerName').dispatchEvent(oldApiClick);
  assert.equal(oldApiClick.defaultPrevented,false);
  assert.equal($('#customerContextMenu').classList.contains('open'),false);
  context.sqlConfig.clientesEdicion=true;
  $('#customerName').dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20}));
  assert.equal($('#customerContextMenu').classList.contains('open'),true);
  assert.equal($('#viewCustomer').hidden,true);
  $('#newCustomer').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal($('#customerModal').classList.contains('open'),true);
  $('#editCustomerDocType').value='67';
  $('#editCustomerDocType').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  $('#editCustomerDocument').value='20369111574';
  $('#editCustomerDocument').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal($('#editCustomerDocument').value,'20-36911157-4');
  $('#editCustomerName').value='Cliente prueba';
  $('#editCustomerName').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal($('#editCustomerName').value,'CLIENTE PRUEBA');
  $('#editCustomerDocument').value='12345678';
  $('#editCustomerCredit').value='1000';
  $('#customerForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(saved.nombre,'CLIENTE PRUEBA');
  assert.equal(saved.limiteCredito,1000);
  assert.equal(saved.idTipoComercio,1);
  assert.equal($('#customerName').dataset.idCliente,'15000');
  assert.equal($('#customerBalance').value,'$ 120.00');
  assert.equal($('#customerBalance').classList.contains('balance-within'),true);
  assert.equal($('#customerBalance').tabIndex,-1);
  context.renderCustomerBalance({limiteCredito:100,cupoDisponible:-20});
  assert.equal($('#customerBalance').value,'$ 120.00');
  assert.equal($('#customerBalance').classList.contains('balance-over'),true);
  $('#customerName').dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20}));
  assert.equal($('#viewCustomer').hidden,false);
  $('#viewCustomer').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(getCount,1);
  assert.equal($('#editCustomerName').value,'CLIENTE PRUEBA');
  assert.equal($('#editCustomerSaldo').value,'$ 120.00');
  assert.equal($('#editCustomerAvailable').value,'$ 1000.00');
  dom.window.close();
});
