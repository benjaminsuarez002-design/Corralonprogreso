const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'../gestion.html'),'utf8');
test('presupuesto de ladrillones divide costo total, aplica margen y carga cantidad',async()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
  dom.window.eval(fs.readFileSync(require('node:path').join(__dirname,'../funciones.js'),'utf8'));
  let payload;const row={},target={row,draftId:'draft'};
  const ctx=vm.createContext({window:dom.window,document:dom.window.document,SQL_PREPARACION:'/api',draftId:'draft',articles:[row],billingAridosTarget:target,
    fetch:async()=>({ok:true,json:async()=>({ok:true,articulo:{gananciaMinorista:.35,impuestoInterno:0}})}),esc:String,
    n:v=>Number(String(v).replace(',','.'))||0,money:v=>Number(v).toFixed(2),$:()=>({value:'3'}),addBillingAridos:async p=>{payload=p;}});
  vm.runInContext(html.slice(html.indexOf('async function openBillingBricksBudget'),html.indexOf('async function importBillingAridos')),ctx);
  await ctx.openBillingBricksBudget({idart:'000123',descripcion:'LADRILLON'},target);
  const dialog=dom.window.document.querySelector('dialog'),confirm=dialog.querySelector('[data-bricks-confirm]');
  await confirm.onclick();assert.equal(payload,undefined,'no guarda un total vacío');
  const total=dialog.querySelector('[data-bricks-total]');total.value='270.000';total.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(total.value,'$ 270.000');total.dispatchEvent(new dom.window.Event('blur'));assert.match(total.value,/270\.000,00/);
  assert.match(dialog.querySelector('[data-bricks-preview]').textContent,/270\.00/);
  assert.match(dialog.querySelector('[data-bricks-preview]').textContent,/364\.50/);
  await confirm.onclick();assert.equal(payload.materials[0].meters,1000);assert.equal(payload.materials[0].costUnit,270);
  assert.equal(dom.window.document.querySelector('dialog'),null);dom.window.close();
});
