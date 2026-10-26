const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const requireDom = createRequire(path.join(__dirname, '..', '.codex-staging', 'importer-dom-test', 'package.json'));
const { JSDOM } = requireDom('jsdom');

test('el cliente se filtra y pagina localmente sin consultar SQL por cada tecla', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'gestion.html'), 'utf8');
  const start = html.indexOf('async function loadSqlCustomers(){');
  const end = html.indexOf('function syncPaymentTableFromDom(){', start);
  assert.ok(start >= 0 && end > start);
  const dom = new JSDOM('<!doctype html><body><input id="customerName"><button id="customerDrop"></button><div id="clientesSql"></div><input id="docNumber"><select id="docType"><option>DNI</option></select><select id="customerTax"><option>Consumidor final</option></select><input id="customerAddress"><input id="customerPhone"><input id="customerEmail"></body>', { url:'http://localhost:8080/gestion.html' });
  const customers = Array.from({length:65}, (_,i)=>({id:i+2,nombre:`NOMBRE ${String(i).padStart(2,'0')}`,documento:String(i),idTipoDoc:96,idTipoIva:5}));
  let requests = 0;
  const context = {
    window:dom.window, document:dom.window.document, console,
    setTimeout, clearTimeout, SQL_PREPARACION:'/api/facturacion',
    customerCatalog:[], customerCatalogReady:false, sqlConfig:null,
    $:selector=>dom.window.document.querySelector(selector),
    norm:value=>String(value||'').toLowerCase().trim(),
    esc:value=>String(value||''),
    scheduleDraft(){}, syncCustomerTaxShort(){},
    fetch:async()=>{requests++;return {ok:true,json:async()=>({ok:true,catalogoCompleto:true,clientes:customers})}}
  };
  vm.createContext(context);
  vm.runInContext(html.match(/function customerUpper\(value\)\{[^\n]*\}/)[0],context);
  vm.runInContext(html.slice(start,end),context);
  await context.loadSqlCustomers();
  context.bindCustomerSearch();
  const input=dom.window.document.querySelector('#customerName');
  input.focus();input.value='NOM';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(requests,1);
  assert.equal(dom.window.document.querySelectorAll('.client-option').length,61);
  for(let i=0;i<61;i++)input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(dom.window.document.querySelectorAll('.client-option').length,65);
  assert.equal(requests,1);
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.match(input.value,/^NOMBRE /);
  dom.window.close();
});
