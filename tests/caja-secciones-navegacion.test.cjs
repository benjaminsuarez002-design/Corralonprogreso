const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('respaldo/caja.html','utf8');
test('atrás desde adicionales o cobranzas vuelve a Caja diaria y adelante restaura la sección sin guardar',async()=>{
 const dom=new JSDOM('<main id="main"></main><div id="popup"></div><input id="sqlCajaDate">',{url:'http://localhost/caja.html'}),w=dom.window,$=id=>w.document.getElementById(id),calls=[];
 const s={window:w,location:w.location,main:$('main'),popup:$('popup'),$,selectedDateKey:'2026-10-20',status:()=>{},load:async()=>calls.push('leer'),fitCajaForm:()=>{}};
 w.CajaCobranzas={close(){calls.push('cerrar-cobranzas');s.main.hidden=false;}};
 s.openAdditional=async record=>{assert.equal(record,false);calls.push('adicionales');s.popup.classList.add('open');};s.openCollections=async record=>{assert.equal(record,false);calls.push('cobranzas');s.main.hidden=true;};
 vm.createContext(s);const start=html.indexOf('  function cajaSectionRoute()');vm.runInContext(html.slice(start,html.indexOf('  async function openAdditional(',start)),s);
 async function traverse(direction){const event=new Promise(resolve=>w.addEventListener('popstate',()=>setTimeout(resolve,0),{once:true}));w.history[direction]();await event;}
 try{for(const section of ['adicionales','cobranzas']){
 s.recordCajaSection(section);await s.restoreCajaSection();assert.equal(s.cajaSectionRoute(),section);const length=w.history.length;s.recordCajaSection(section);assert.equal(w.history.length,length);
 await traverse('back');assert.equal(s.cajaSectionRoute(),'diaria');assert.equal(s.main.hidden,false);assert.equal(s.popup.classList.contains('open'),false);assert.equal($('sqlCajaDate').value,'2026-10-20');
 await traverse('forward');assert.equal(s.cajaSectionRoute(),section);assert.equal(section==='cobranzas'?s.main.hidden:s.popup.classList.contains('open'),true);
 await traverse('back');}
 assert.ok(calls.includes('adicionales'));assert.ok(calls.includes('cobranzas'));assert.ok(calls.includes('leer'));
 }finally{w.close();}
});
