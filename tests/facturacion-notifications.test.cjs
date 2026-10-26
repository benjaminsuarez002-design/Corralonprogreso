const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('../.codex-staging/importer-dom-test/node_modules/jsdom');
const html=fs.readFileSync('gestion.html','utf8'),tick=()=>new Promise(r=>setTimeout(r,25));
function setup(admin=true,{delayStart=null}={}){
 const dom=new JSDOM(html,{url:'http://localhost/gestion.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,streams=[],writes=[],imports=[];
 let user={id:'test',nivel:admin?'administrador':'vendedor'};
 const menuMarkup=fs.readFileSync('funciones.js','utf8').match(/const systemMenuMarkup=(.+);/)[1];
 w.document.body.insertAdjacentHTML('beforeend',JSON.parse(menuMarkup));
 w.CorralonFunciones={menuSessionUser:()=>user};w.CorralonSystem={syncProvidersCache:async()=>[]};w.alert=message=>{throw Error(message)};w.open=()=>{};
 const fire={getFirestore:()=>({}),collection:()=>{},doc:(_db,col,id)=>({col,id}),query(){},where(){},Timestamp:class{},getDocFromServer:async()=>({exists:()=>false,data:()=>({})}),getDocsFromServer:async()=>({docs:[]}),onSnapshot(){},serverTimestamp:()=>({seconds:1}),setDoc:async(...args)=>writes.push(args),runTransaction:async(_db,fn)=>fn({get:async()=>({data:()=>({ultimo:0})}),set:(...args)=>writes.push(args)})};
 w.notificationImport=async url=>{imports.push(url);if(url.includes('firebase-app'))return{initializeApp:()=>({}),getApps:()=>[]};if(url.includes('firebase-firestore'))return fire;return {createNotificationCache:options=>{
  const rows=options.collectionName==='pedidos'?[{id:'1',firestoreId:'order1',confirmado:true,pedido:false,proveedor:'Lourdes',createdAt:{seconds:Math.floor(Date.now()/1000)}}]:[{id:'2',firestoreId:'pendiente_2',tipo:'pendiente',detalle:'Revisar cemento',createdAt:{seconds:Math.floor(Date.now()/1000)}}];
  const stream={options,starts:0,stops:0,start:async()=>{stream.starts++;if(delayStart)await delayStart;options.onChange(rows,true);},stop:()=>stream.stops++,restore:()=>options.onChange(rows,true),refresh:async()=>{},values:()=>rows};streams.push(stream);return stream;
 }};};
 const code=w.document.getElementById('system-notifications').textContent.replace(/import\(/g,'window.notificationImport(');w.eval(code);
 // Ejecutar la apertura real compartida por Facturación y los módulos SQL.
 const navigation=w.document.getElementById('invoice-system-navigation').textContent;
 const openMenu=navigation.slice(navigation.indexOf(' function openMenu(){'),navigation.indexOf(' function initializeReceipts(){'));
 w.eval(`(()=>{const menu=document.getElementById('systemMenu'),backdrop=document.getElementById('systemMenuBackdrop'),toggle=document.getElementById('systemMenuToggle');let menuMotion=0,menuCloseTimer,menuReturnFocus;const refreshPermissions=()=>{};${openMenu};window.CorralonInvoiceSections={openMenu};toggle.addEventListener('click',openMenu);})();`);
 return{w,streams,writes,imports,setUser:value=>{user=value;w.dispatchEvent(new w.Event('menu-user-validated'));},q:s=>w.document.querySelector(s)};
}
test('campana reutiliza popup, búsqueda local, pendientes y resueltas; inicia listeners una sola vez',async()=>{
 const s=setup();try{
 assert.equal(s.q('#systemNotificationsBell').hidden,false);assert.equal(s.imports.length,0);
 s.q('#systemMenuToggle').click();await tick();assert.equal(s.streams.length,2);assert.equal(s.q('[data-notification-count]').textContent,'2');
 s.q('#systemNotificationsBell').click();await tick();assert.equal(s.q('#systemNotifications #reviewModal').classList.contains('visible'),true);
 const search=s.q('#systemNotifications #reviewSearch');search.value='cemento';search.dispatchEvent(new s.w.Event('input'));assert.equal(s.q('#systemNotifications #reviewList').querySelectorAll('.review-item').length,1);assert.match(s.q('#systemNotifications #reviewList').textContent,/Revisar cemento/);
 s.q('#systemNotifications #reviewPendingBtn').click();await tick();assert.equal(s.q('#systemNotifications #pendingModal').classList.contains('visible'),true);
 s.q('#systemNotifications #closePendingModal').click();s.q('#systemNotifications #openResolvedNotifications').click();await tick();assert.equal(s.q('#systemNotifications #resolvedReviewModal').classList.contains('visible'),true);
 s.q('#systemMenuToggle').click();await tick();assert.equal(s.streams.length,2);assert.deepEqual(s.streams.map(stream=>stream.starts),[1,1]);assert.equal(s.writes.length,0);assert.equal(s.w.location.hash,'');
 s.setUser({id:'test',nivel:'vendedor'});assert.equal(s.q('#systemNotificationsBell').hidden,true);assert.ok(s.streams.every(stream=>stream.stops===1));assert.equal(s.q('#systemNotifications .review-modal.visible'),null);
 }finally{s.w.close();}
});
test('usuario sin permisos no inicia conexiones ni abre notificaciones',async()=>{const s=setup(false);try{s.q('#systemMenuToggle').click();await tick();assert.equal(s.q('#systemNotificationsBell').hidden,true);assert.equal(s.imports.length,0);assert.equal(s.streams.length,0);}finally{s.w.close();}});

test('abrir menú desde un módulo SQL precarga contador sin pulsar la campana ni duplicar listeners',async()=>{
 const s=setup();try{
 s.w.CorralonInvoiceSections.openMenu();await tick();
 assert.equal(s.streams.length,2);assert.equal(s.q('[data-notification-count]').textContent,'2');
 assert.equal(s.q('#systemNotifications #reviewModal').classList.contains('visible'),false);
 s.w.CorralonInvoiceSections.openMenu();await tick();assert.deepEqual(s.streams.map(stream=>stream.starts),[1,1]);
 s.q('#systemNotificationsBell').click();await tick();assert.equal(s.q('#systemNotifications #reviewModal').classList.contains('visible'),true);
 assert.equal(s.writes.length,0);
 }finally{s.w.close();}
});

test('primera pulsación de campana espera la carga y abre con datos, sin requerir segundo clic',async()=>{
 let release;const delayStart=new Promise(resolve=>{release=resolve;});const s=setup(true,{delayStart});try{
 s.q('#systemNotificationsBell').click();await tick();
 assert.equal(s.q('#systemNotificationsBell').disabled,true);
 assert.equal(s.q('#systemNotifications #reviewModal').classList.contains('visible'),false);
 release();await tick();
 assert.equal(s.q('#systemNotificationsBell').disabled,false);
 assert.equal(s.q('#systemNotifications #reviewModal').classList.contains('visible'),true);
 assert.equal(s.q('#systemNotifications #reviewList').querySelectorAll('.review-item').length,2);
 assert.equal(s.writes.length,0);
 }finally{release();s.w.close();}
});
