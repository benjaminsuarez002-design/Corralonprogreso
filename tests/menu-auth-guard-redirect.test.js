const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const guard = fs.readFileSync(path.join(__dirname, '..', 'menu-auth-guard.js'), 'utf8');

function redirectWithoutSession(page) {
  let destination = '';
  const storage = { getItem: () => null, removeItem: () => {} };
  const context = {
    document: { documentElement: { style: {} }, currentScript: { dataset: { menuGuard: page } } },
    location: { pathname: `/${page}.html`, search: '', replace: file => { destination = file; } },
    localStorage: storage,
    sessionStorage: storage,
    URLSearchParams,
  };
  vm.runInNewContext(guard, context);
  return destination;
}

test('Facturación sin sesión vuelve al Menú, sin cambiar el acceso de otras páginas', () => {
  assert.equal(redirectWithoutSession('facturacion'), 'menu.html');
  assert.equal(redirectWithoutSession('caja'), 'index.html');
});

test('Facturación acepta en una pestaña nueva la sesión temporal compartida', async () => {
  let destination = '';
  const user = { id:'benja', nombre:'Benja', nivel:'personalizado', permisos:['facturacion'] };
  const local = new Map([['corralon_menu_shared_session_v1', JSON.stringify({ usuario:user, expiresAt:Date.now()+60000 })]]);
  const session = new Map();
  const storage = map => ({ getItem:key=>map.get(key)??null, setItem:(key,value)=>map.set(key,value), removeItem:key=>map.delete(key) });
  const db = { collection:()=>({
    doc:()=>({ get:async()=>({ exists:true, id:user.id, data:()=>user }) }),
    get:async()=>({ docs:[] })
  }) };
  const context = {
    document:{ documentElement:{ style:{} }, currentScript:{ dataset:{ menuGuard:'facturacion' } }, scripts:[], head:{ appendChild(){} }, createElement:()=>({}) },
    location:{ pathname:'/gestion.html', search:'', replace:file=>{destination=file} },
    localStorage:storage(local), sessionStorage:storage(session), URLSearchParams,
    window:{ firebase:{ firestore:()=>db, apps:[{}] }, dispatchEvent(){} },
    CustomEvent:function(){}, console, setTimeout, clearTimeout
  };
  vm.runInNewContext(guard,context);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(destination,'');
  assert.equal(context.document.documentElement.style.visibility,'');
  assert.ok(session.has('corralon_menu_active_user_session_v1'));
});

test('un corte de validación remota no cierra una sesión temporal vigente', async () => {
  let destination = '';
  const user = { id:'benja', nombre:'Benja', nivel:'personalizado', permisos:['facturacion'] };
  const local = new Map([['corralon_menu_shared_session_v1', JSON.stringify({ usuario:user, expiresAt:Date.now()+60000 })]]);
  const session = new Map();
  const storage = map => ({ getItem:key=>map.get(key)??null, setItem:(key,value)=>map.set(key,value), removeItem:key=>map.delete(key) });
  const context = {
    document:{ documentElement:{ style:{} }, currentScript:{ dataset:{ menuGuard:'facturacion' } }, scripts:[], head:{ appendChild(){} }, createElement:()=>({}) },
    location:{ pathname:'/gestion.html', search:'', replace:file=>{destination=file} },
    localStorage:storage(local), sessionStorage:storage(session), URLSearchParams,
    window:{ firebase:{ firestore:()=>({ collection:()=>({ doc:()=>({ get:async()=>{throw new Error('sin red')} }) }) }), apps:[{}] }, dispatchEvent(){} },
    CustomEvent:function(){}, console, setTimeout, clearTimeout
  };
  vm.runInNewContext(guard,context);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(destination,'');
  assert.equal(context.document.documentElement.style.visibility,'');
  assert.ok(local.has('corralon_menu_shared_session_v1'));
});
