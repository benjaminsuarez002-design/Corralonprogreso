const SUPABASE_URL='https://tizyjenayrcdkcodsjnc.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpenlqZW5heXJjZGtjb2Rzam5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzE4MDYsImV4cCI6MjA4NzgwNzgwNn0.Xue8zgo8QJiKTErtzfUOgpczMngsAaePJZqLvA8Z7oI';
const SUPABASE_BUCKET='Archivos';
const COMPROBANTES_TABLE='comprobantes';
const ALIAS_TABLE='comprobantes_aliases';

const rows=[]; let aliases=[]; let resumenRows=[]; let resumenDias=[]; let resumenFechaIso=isoHoy();
let onPickAlias=null,fileTarget=null,guardando=false,confirmStep=0,confirmAction=null,lastErrAt=0;
let newRow=mkRow();

const els={
  tabAlias:document.getElementById('tabAlias'),tabComp:document.getElementById('tabComp'),tabResumen:document.getElementById('tabResumen'),
  panelAlias:document.getElementById('panelAlias'),panelComp:document.getElementById('panelComp'),panelResumen:document.getElementById('panelResumen'),
  aliasNombreInput:document.getElementById('aliasNombreInput'),aliasAliasInput:document.getElementById('aliasAliasInput'),aliasCuitInput:document.getElementById('aliasCuitInput'),aliasList:document.getElementById('aliasList'),
  rows:document.getElementById('rows'),resumenBody:document.getElementById('resumenBody'),resumenFechaLabel:document.getElementById('resumenFechaLabel'),
  btnDiaPrev:document.getElementById('btnDiaPrev'),btnDiaNext:document.getElementById('btnDiaNext'),totalMonto:document.getElementById('totalMonto'),
  nMonto:document.getElementById('nMonto'),nMaquina:document.getElementById('nMaquina'),nTransfer:document.getElementById('nTransfer'),nFecha:document.getElementById('nFecha'),nHora:document.getElementById('nHora'),nCliente:document.getElementById('nCliente'),
  pickerBg:document.getElementById('pickerBg'),pickerList:document.getElementById('pickerList'),
  confirmBg:document.getElementById('confirmBg'),confirmHead:document.getElementById('confirmHead'),confirmBody:document.getElementById('confirmBody'),confirmOk:document.getElementById('confirmOk'),confirmCancel:document.getElementById('confirmCancel'),
  btnGuardarNuevo:document.getElementById('btnGuardarNuevo'),btnLimpiar:document.getElementById('btnLimpiar'),btnNuevoComp:document.getElementById('btnNuevoComp'),compFileInput:document.getElementById('compFileInput')
};

const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const nt=v=>String(v||'').trim().toLowerCase();
const isMobile=()=>window.matchMedia('(max-width:760px)').matches;
function toastErr(prefix,e){console.error(prefix,e);const n=Date.now();if(n-lastErrAt>4000){lastErrAt=n;alert(`${prefix}: ${String(e?.message||e)}`);}}

function sbHeaders(json){const h={Authorization:`Bearer ${SUPABASE_KEY}`,apikey:SUPABASE_KEY};if(json)h['Content-Type']='application/json';return h;}
async function sb(path,opt={}){const r={method:opt.method||'GET',headers:{...sbHeaders(!!opt.body&&opt.rawBody===undefined),...(opt.headers||{})}};if(opt.rawBody!==undefined)r.body=opt.rawBody;else if(opt.body!==undefined)r.body=JSON.stringify(opt.body);const rs=await fetch(`${SUPABASE_URL}${path}`,r);const t=await rs.text();if(!rs.ok)throw new Error(t||`Error ${rs.status}`);if(!t)return null;try{return JSON.parse(t);}catch{return t;}}

function isoHoy(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function fechaHoy(){const d=new Date();return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;}
function horaAhora(){const d=new Date();return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function fechaDesdeIso(i){const m=String(i||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:fechaHoy();}
function isoDesdeFecha(f){const s=String(f||'').trim();let m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(m)return `${m[3]}-${String(Number(m[2])||0).padStart(2,'0')}-${String(Number(m[1])||0).padStart(2,'0')}`;m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(m)return `${m[1]}-${String(Number(m[2])||0).padStart(2,'0')}-${String(Number(m[3])||0).padStart(2,'0')}`;return isoHoy();}
function horaKey(h){const m=String(h||'').match(/^(\d{1,2}):(\d{2})/);if(!m)return 9999;return Number(m[1])*60+Number(m[2]);}
function parseMonto(v){const c=String(v??'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');const n=Number(c);return Number.isFinite(n)?n:0;}
function fmtMonto(n){return '$ '+Number(n||0).toLocaleString('es-AR',{minimumFractionDigits:0,maximumFractionDigits:2});}
function fmtMontoCampo(v){const t=String(v??'').trim();if(!t)return '';const n=parseMonto(t);if(!Number.isFinite(n))return '';return '$ '+n.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function formatearMaquina(v){const raw=String(v||'').trim();if(!raw)return '';const g=raw.match(/\d+/g)||[];if(g.length>=2)return `${String(Number(g[0])||0).padStart(4,'0')}-${String(Number(g[1])||0).padStart(8,'0')}`;if(g.length===1&&g[0].length>4)return `${String(Number(g[0].slice(0,4))||0).padStart(4,'0')}-${String(Number(g[0].slice(4))||0).padStart(8,'0')}`;return raw;}

function mkRow(){return{id:null,monto:'',maquina:'',transfer:'',fecha:'',hora:'',cliente:'',comprobante:null,_saving:false,_pending:false};}
function hasData(r){return !!(String(r?.monto||'').trim()||String(r?.maquina||'').trim()||String(r?.transfer||'').trim()||String(r?.cliente||'').trim()||r?.comprobante);}
function proveedorNombre(v){const raw=String(v||'').trim();if(!raw)return '';const f=aliases.find(a=>nt(a.nombre)===nt(raw)||(a.alias&&nt(a.alias)===nt(raw)));return f?.nombre||raw;}

function recalcTotal(){els.totalMonto.textContent=fmtMonto(rows.reduce((a,r)=>a+parseMonto(r.monto),0));}
function autocompletarFechaHora(){if(!els.nFecha.value.trim())els.nFecha.value=fechaHoy();if(!els.nHora.value.trim())els.nHora.value=horaAhora();}
function sortRows(){rows.sort((a,b)=>{const fa=isoDesdeFecha(a.fecha),fb=isoDesdeFecha(b.fecha);if(fa!==fb)return fa.localeCompare(fb);const ha=horaKey(a.hora),hb=horaKey(b.hora);if(ha!==hb)return ha-hb;return Number(a.id||0)-Number(b.id||0);});}

function activarTab(tab){const a=tab==='alias',c=tab==='comp',r=tab==='resumen';els.tabAlias.classList.toggle('active',a);els.tabComp.classList.toggle('active',c);els.tabResumen.classList.toggle('active',r);els.panelAlias.classList.toggle('active',a);els.panelComp.classList.toggle('active',c);els.panelResumen.classList.toggle('active',r);if(r)refrescarResumen().catch(console.error);}

function mapAliasRecord(a){
  const pkCol = 'id';
  const pkVal = a?.id;
  return {
    pkCol,
    pkVal,
    nombre: String(a?.nombre || a?.name || '').trim(),
    alias: String(a?.alias || '').trim(),
    cuit: String(a?.cuit || '').trim()
  };
}

function renderAliases(){if(!aliases.length){els.aliasList.innerHTML='<div class="alias-row"><div class="alias-name" style="color:#888;font-weight:400">Sin alias cargados</div></div>';return;}els.aliasList.innerHTML=aliases.map((a,i)=>`<div class="alias-row"><div><div class="alias-name">${esc(a.nombre)}</div><div class="alias-meta">${esc(a.alias?`Alias: ${a.alias}`:'Alias: -')} | ${esc(a.cuit?`CUIT: ${a.cuit}`:'CUIT: -')}</div></div><button class="btn-del" onclick="delAlias(${i})">x</button></div>`).join('');}

function isMissingTableError(e){return /PGRST205|Could not find the table|could not find the table/i.test(String(e?.message||e));}

async function cargarAliases(){try{const d=await sb(`/rest/v1/${ALIAS_TABLE}?select=id,nombre,alias,cuit&order=nombre.asc`);aliases=(Array.isArray(d)?d:[]).map(mapAliasRecord).filter(a=>a.nombre&&a.pkVal!==undefined&&a.pkVal!==null);aliases.sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));renderAliases();}catch(e){if(!isMissingTableError(e))throw e;aliases=[];els.aliasList.innerHTML='<div class="alias-row"><div class="alias-name" style="color:#888;font-weight:400">Falta crear la tabla comprobantes_aliases en Supabase.</div></div>';}}

async function addAlias(){const nombre=String(els.aliasNombreInput.value||'').trim(),alias=String(els.aliasAliasInput.value||'').trim(),cuit=String(els.aliasCuitInput.value||'').trim();if(!nombre)return;const ex=aliases.some(a=>nt(a.nombre)===nt(nombre)||(alias&&nt(a.alias)===nt(alias)));if(ex){alert('Ese alias/nombre ya existe.');return;}let d;try{d=await sb(`/rest/v1/${ALIAS_TABLE}`,{method:'POST',body:[{nombre,alias:alias||null,cuit:cuit||null}],headers:{Prefer:'return=representation'}});}catch(e){if(isMissingTableError(e)){alert('Falta crear la tabla comprobantes_aliases en Supabase. Te paso el SQL en el chat.');return;}throw e;}const s=Array.isArray(d)?d[0]:d;if(s){const m=mapAliasRecord(s);if(m.nombre&&m.pkVal!==undefined&&m.pkVal!==null)aliases.push(m);}aliases.sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));renderAliases();els.aliasNombreInput.value='';els.aliasAliasInput.value='';els.aliasCuitInput.value='';els.aliasNombreInput.focus();}
window.delAlias=async idx=>{const i=Number(idx);if(!Number.isInteger(i)||i<0||i>=aliases.length)return;const a=aliases[i];await sb(`/rest/v1/${ALIAS_TABLE}?${a.pkCol}=eq.${encodeURIComponent(a.pkVal)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});aliases.splice(i,1);renderAliases();};

function abrirPicker(cb){onPickAlias=cb;if(!aliases.length){els.pickerList.innerHTML='<div class="picker-empty">No hay alias cargados en Supabase.</div>';}else{els.pickerList.innerHTML=aliases.map(a=>{const d=[a.nombre,a.alias?`Alias: ${a.alias}`:'',a.cuit?`CUIT: ${a.cuit}`:''].filter(Boolean).join(' - ');return `<button class="picker-item" data-alias="${esc(a.nombre)}">${esc(d)}</button>`;}).join('');}els.pickerBg.classList.add('open');}
function cerrarPicker(){els.pickerBg.classList.remove('open');onPickAlias=null;}
function encodeStoragePath(path){return String(path||'').split('/').map(encodeURIComponent).join('/');}
function setGuardandoState(on){guardando=!!on;els.btnGuardarNuevo.disabled=on;els.btnLimpiar.disabled=on;els.confirmOk.disabled=on;els.btnGuardarNuevo.textContent=on?'Guardando...':'Guardar y nuevo';}
function safeRevoke(url){if(typeof url==='string'&&url.startsWith('blob:'))URL.revokeObjectURL(url);}

function dbToRow(r){const fi=String(r?.fecha_iso||isoHoy());return{id:Number(r?.id||0),monto:fmtMontoCampo(r?.monto??''),maquina:String(r?.maquina||''),transfer:proveedorNombre(r?.transferencia||''),fecha:String(r?.fecha_texto||fechaDesdeIso(fi)),hora:String(r?.hora||''),cliente:String(r?.cliente||''),comprobante:r?.comprobante_url?{name:String(r?.comprobante_nombre||'Comprobante'),url:String(r?.comprobante_url||''),type:String(r?.comprobante_tipo||''),file:null}:null,_saving:false,_pending:false};}
function rowPayload(r){const fi=isoDesdeFecha(r.fecha||fechaHoy()),c=r.comprobante||null;return{fecha_iso:fi,fecha_texto:r.fecha||fechaDesdeIso(fi),hora:String(r.hora||'').trim(),cliente:String(r.cliente||'').trim(),maquina:formatearMaquina(r.maquina||''),transferencia:proveedorNombre(r.transfer||''),monto:parseMonto(r.monto),comprobante_nombre:c?.name||null,comprobante_url:c?.url&&!String(c.url).startsWith('blob:')?c.url:null,comprobante_tipo:c?.type||null};}

async function insComp(p){const d=await sb(`/rest/v1/${COMPROBANTES_TABLE}`,{method:'POST',body:[p],headers:{Prefer:'return=representation'}});return Array.isArray(d)?d[0]:d;}
async function updComp(id,p){const d=await sb(`/rest/v1/${COMPROBANTES_TABLE}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:p,headers:{Prefer:'return=representation'}});return Array.isArray(d)?d[0]:d;}
async function delComp(id){await sb(`/rest/v1/${COMPROBANTES_TABLE}?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});}

async function subirComp(comp,keyPart){if(!comp?.file)return comp;const n=String(comp.name||`comprobante_${keyPart}`).replace(/[^a-zA-Z0-9._-]/g,'_');const path=`comprobantes/${Date.now()}_${keyPart}_${n}`;const enc=encodeStoragePath(path);await sb(`/storage/v1/object/${SUPABASE_BUCKET}/${enc}`,{method:'POST',rawBody:comp.file,headers:{...sbHeaders(false),'x-upsert':'true','Content-Type':comp.type||'application/octet-stream'}});const url=`${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${enc}`;safeRevoke(comp.url);return{name:comp.name||n,url,type:comp.type||'',file:null};}

function upsertGrid(dbRow){if(!dbRow?.id)return;const r=dbToRow(dbRow);const i=rows.findIndex(x=>Number(x.id)===Number(r.id));if(i>=0)rows[i]={...rows[i],...r};else rows.push(r);sortRows();render();}

async function persistOnce(state){if(!hasData(state))return null;state.maquina=formatearMaquina(state.maquina);state.monto=fmtMontoCampo(state.monto);state.transfer=proveedorNombre(state.transfer);if(state.comprobante?.file)state.comprobante=await subirComp(state.comprobante,state.id||Math.floor(Math.random()*100000));const p=rowPayload(state);const saved=state.id?await updComp(state.id,p):await insComp(p);if(saved?.id)state.id=Number(saved.id);return saved||null;}

async function persistQueued(state){if(!state)return null;if(state._saving){state._pending=true;return null;}state._saving=true;try{const s=await persistOnce(state);if(s)upsertGrid(s);return s;}finally{state._saving=false;if(state._pending){state._pending=false;await persistQueued(state);}}}

async function cargarRowsHoy(){const h=isoHoy();const d=await sb(`/rest/v1/${COMPROBANTES_TABLE}?select=id,fecha_iso,fecha_texto,hora,cliente,maquina,transferencia,monto,comprobante_url,comprobante_nombre,comprobante_tipo&fecha_iso=eq.${encodeURIComponent(h)}&order=hora.asc.nullslast,id.asc`);rows.length=0;(Array.isArray(d)?d:[]).forEach(r=>rows.push(dbToRow(r)));sortRows();render();}

function hydrateNew(){newRow.monto=fmtMontoCampo(els.nMonto.value.trim());newRow.maquina=formatearMaquina(els.nMaquina.value.trim());newRow.transfer=proveedorNombre(els.nTransfer.value.trim());newRow.fecha=els.nFecha.value.trim()||fechaHoy();newRow.hora=els.nHora.value.trim()||horaAhora();newRow.cliente=els.nCliente.value.trim();if(!newRow.comprobante)newRow.comprobante=null;}
async function syncNew(){hydrateNew();if(!hasData(newRow))return;await persistQueued(newRow);}

function limpiarInputsNuevo(){safeRevoke(newRow.comprobante?.url);newRow=mkRow();els.nMonto.value='';els.nMaquina.value='';els.nTransfer.value='';els.nFecha.value=fechaHoy();els.nHora.value=horaAhora();els.nCliente.value='';actualizarBotonNuevoComp();}
async function guardarYNuevoReal(){try{await syncNew();}catch(e){toastErr('No se pudo guardar el registro nuevo',e);return;}limpiarInputsNuevo();if(isMobile())els.nMaquina.focus();else els.nMonto.focus();await refrescarResumen();}

function render(){sortRows();els.rows.innerHTML=rows.map((r,i)=>`<div class="fila"><input class="inp" value="${esc(r.cliente)}" onchange="upd(${i},'cliente',this.value)" onblur="upd(${i},'cliente',this.value)"><input class="inp" value="${esc(r.maquina)}" onchange="upd(${i},'maquina',this.value)" onblur="upd(${i},'maquina',this.value)"><input class="inp num" value="${esc(fmtMontoCampo(r.monto))}" onchange="upd(${i},'monto',this.value)" onblur="upd(${i},'monto',this.value)"><input class="inp alias-pick" value="${esc(proveedorNombre(r.transfer))}" readonly onclick="pickRowAlias(${i})" placeholder="Elegir alias"><input class="inp" value="${esc(r.fecha)}" onchange="upd(${i},'fecha',this.value)" onblur="upd(${i},'fecha',this.value)"><input class="inp" value="${esc(r.hora)}" onchange="upd(${i},'hora',this.value)" onblur="upd(${i},'hora',this.value)"><button class="btn-del" onclick="delRow(${i})" title="Eliminar">x</button><button class="btn-comp ${r.comprobante?'ok':''}" data-row="${i}" onclick="subirCompFila(${i})" title="${esc(r.comprobante?.name||'Sin comprobante')}">${r.comprobante?'Comprobante ✓':'Subir'}</button></div>`).join('');recalcTotal();}

window.upd=(idx,key,val)=>{const r=rows[idx];if(!r)return;if(key==='monto')r[key]=fmtMontoCampo(val);else if(key==='maquina')r[key]=formatearMaquina(val);else if(key==='transfer')r[key]=proveedorNombre(val);else r[key]=String(val||'').trim();recalcTotal();persistQueued(r).catch(e=>toastErr('Error sincronizando fila',e));if(key==='monto'||key==='maquina')render();};
window.delRow=async idx=>{const r=rows[idx];if(!r)return;try{if(r.id)await delComp(r.id);}catch(e){toastErr('No se pudo borrar la fila',e);return;}safeRevoke(r.comprobante?.url);rows.splice(idx,1);render();refrescarResumen().catch(console.error);};
window.pickRowAlias=idx=>{const r=rows[idx];if(!r)return;abrirPicker(async nombre=>{r.transfer=proveedorNombre(nombre);render();try{await persistQueued(r);await refrescarResumen();}catch(e){toastErr('No se pudo sincronizar alias de la fila',e);}});};
window.subirCompFila=idx=>abrirSelectorComp({type:'row',idx});

function actualizarBotonNuevoComp(){const c=newRow.comprobante;if(c){els.btnNuevoComp.textContent='Comprobante ✓';els.btnNuevoComp.classList.add('ok');els.btnNuevoComp.title=c.name||'Comprobante';}else{els.btnNuevoComp.textContent='Subir';els.btnNuevoComp.classList.remove('ok');els.btnNuevoComp.title='Sin comprobante';}}
function targetDesdeEl(el){const b=el?.closest?.('.btn-comp');if(b?.dataset?.row!==undefined)return{type:'row',idx:Number(b.dataset.row)};if(b?.dataset?.new==='1')return{type:'new'};const f=el?.closest?.('.fila');if(f){const i=[...document.querySelectorAll('#rows .fila')].indexOf(f);if(i>=0)return{type:'row',idx:i};}return{type:'new'};}
function abrirSelectorComp(target){fileTarget=target;els.compFileInput.value='';els.compFileInput.click();}

async function aplicarComp(file,target){if(!file||!target)return;const c={name:file.name||'Comprobante',url:URL.createObjectURL(file),type:file.type||'',file};if(target.type==='new'){safeRevoke(newRow.comprobante?.url);newRow.comprobante=c;actualizarBotonNuevoComp();try{await syncNew();if(isMobile())els.nTransfer.focus();await refrescarResumen();}catch(e){toastErr('No se pudo subir/sincronizar comprobante nuevo',e);}return;}if(target.type==='row'){const i=Number(target.idx),r=rows[i];if(!r)return;safeRevoke(r.comprobante?.url);r.comprobante=c;render();try{await persistQueued(r);await refrescarResumen();}catch(e){toastErr('No se pudo subir/sincronizar comprobante de la fila',e);}}}

function primerArchivoDT(dt){if(!dt?.files||!dt.files.length)return null;return dt.files[0];}
function primerArchivoCB(cb){const it=cb?.items||[];for(const i of it){if(i.kind==='file'){const f=i.getAsFile();if(f)return f;}}return null;}

async function abrirPickerNuevo(){abrirPicker(async nombre=>{els.nTransfer.value=proveedorNombre(nombre);try{await syncNew();if(isMobile())await guardarYNuevoReal();else els.nCliente.focus();}catch(e){toastErr('No se pudo guardar alias del registro nuevo',e);}});}
window.abrirComprobanteDesdeResumen=idx=>{const r=resumenRows[idx];if(!r?.comprobante_url)return;window.open(r.comprobante_url,'_blank');};

function renderResumen(){if(!resumenRows.length){els.resumenBody.innerHTML='<div class="resumen-vacio">Sin comprobantes guardados para ese día.</div>';return;}const g=new Map();resumenRows.forEach((r,idx)=>{const p=proveedorNombre(r.transferencia||'')||'Sin proveedor';if(!g.has(p))g.set(p,[]);g.get(p).push({...r,__idx:idx});});let td=0;const html=[...g.entries()].map(([prov,items])=>{const ord=items.slice().sort((a,b)=>{const ka=horaKey(a.hora),kb=horaKey(b.hora);if(ka!==kb)return ka-kb;return Number(a.id||0)-Number(b.id||0);});const tp=ord.reduce((a,it)=>a+Number(it.monto||0),0);td+=tp;return `<div class="resumen-card"><div class="resumen-head"><div class="resumen-alias">${esc(prov)}</div><div class="resumen-total-alias">Total: ${fmtMonto(tp)}</div></div>${ord.map(it=>{const comp=it.comprobante_url?`<button class="resumen-comp-link" onclick="abrirComprobanteDesdeResumen(${it.__idx})">${esc(it.maquina||'Ver comprobante')}</button>`:`<button class="resumen-comp-link" disabled>${esc(it.maquina||'-')}</button>`;return `<div class="resumen-row"><div class="resumen-left"><div class="resumen-hora">${esc(it.hora||'-')}</div><div class="resumen-comp">${comp}</div></div><div class="resumen-right"><div class="resumen-cli">${esc(it.cliente||'-')}</div><div class="resumen-monto-item">${fmtMonto(it.monto||0)}</div></div></div>`;}).join('')}</div>`;}).join('');els.resumenBody.innerHTML=html+`<div class="resumen-card"><div class="resumen-head"><div class="resumen-alias">Total del día</div><div class="resumen-total-alias">${fmtMonto(td)}</div></div></div>`;}

function updResumenNav(){if(!resumenDias.length){els.resumenFechaLabel.textContent='Sin datos';els.btnDiaPrev.disabled=true;els.btnDiaNext.disabled=true;return;}const i=resumenDias.indexOf(resumenFechaIso);const s=i>=0?i:resumenDias.length-1;resumenFechaIso=resumenDias[s];els.resumenFechaLabel.textContent=fechaDesdeIso(resumenFechaIso);els.btnDiaPrev.disabled=s<=0;els.btnDiaNext.disabled=s>=resumenDias.length-1;}

async function cargarDiasResumen(){const d=await sb(`/rest/v1/${COMPROBANTES_TABLE}?select=fecha_iso&order=fecha_iso.asc`);const set=new Set();(Array.isArray(d)?d:[]).forEach(r=>{const i=String(r?.fecha_iso||'').trim();if(i)set.add(i);});resumenDias=[...set];if(!resumenDias.includes(resumenFechaIso))resumenFechaIso=resumenDias.length?resumenDias[resumenDias.length-1]:isoHoy();updResumenNav();}
async function cargarResumenDia(iso){const d=await sb(`/rest/v1/${COMPROBANTES_TABLE}?select=id,fecha_iso,fecha_texto,hora,cliente,maquina,transferencia,monto,comprobante_url,comprobante_nombre,comprobante_tipo&fecha_iso=eq.${encodeURIComponent(iso)}&order=hora.asc.nullslast,id.asc`);resumenRows=Array.isArray(d)?d:[];renderResumen();}
async function refrescarResumen(){try{await cargarDiasResumen();if(!resumenDias.length){resumenRows=[];renderResumen();return;}await cargarResumenDia(resumenFechaIso);}catch(e){console.error(e);els.resumenBody.innerHTML=`<div class="resumen-vacio">No se pudo cargar resumen: ${esc(String(e.message||e))}</div>`;}}
function moverDia(d){if(!resumenDias.length)return;const i=resumenDias.indexOf(resumenFechaIso);if(i<0)return;const n=i+d;if(n<0||n>=resumenDias.length)return;resumenFechaIso=resumenDias[n];updResumenNav();cargarResumenDia(resumenFechaIso).catch(console.error);}

function txtConfirm(a,s){if(a==='limpiar'){if(s===1)return{h:'Confirmación 1/3',b:'¿Seguro que querés borrar los comprobantes cargados hoy?',ok:'Continuar'};if(s===2)return{h:'Confirmación 2/3',b:'Se eliminarán de Supabase. ¿Seguimos?',ok:'Continuar'};if(s===3)return{h:'Confirmación 3/3',b:'Último paso: confirmar borrado total.',ok:'Sí, borrar'};}if(a==='guardarNuevo'){if(s===1)return{h:'Confirmación 1/3',b:'¿Guardar fila actual y abrir un nuevo registro?',ok:'Continuar'};if(s===2)return{h:'Confirmación 2/3',b:'Todo ya se sincroniza en Supabase al editar. ¿Seguimos?',ok:'Continuar'};if(s===3)return{h:'Confirmación 3/3',b:'Último paso: confirmar guardar y nuevo.',ok:'Sí, guardar'};}return null;}
function abrirConfirm(a){confirmAction=a;confirmStep=0;avanzarConfirm().catch(console.error);}function cerrarConfirm(){confirmAction=null;confirmStep=0;els.confirmBg.classList.remove('open');}

async function limpiarDia(){const ids=[...new Set(rows.map(r=>Number(r.id)).filter(id=>Number.isFinite(id)&&id>0))];if(Number.isFinite(Number(newRow.id))&&Number(newRow.id)>0&&!ids.includes(Number(newRow.id)))ids.push(Number(newRow.id));for(const id of ids)await delComp(id);rows.forEach(r=>safeRevoke(r?.comprobante?.url));rows.length=0;limpiarInputsNuevo();render();await refrescarResumen();}
async function avanzarConfirm(){if(!confirmAction||guardando)return;confirmStep+=1;const t=txtConfirm(confirmAction,confirmStep);if(t){els.confirmHead.textContent=t.h;els.confirmBody.textContent=t.b;els.confirmOk.textContent=t.ok;els.confirmBg.classList.add('open');return;}setGuardandoState(true);try{if(confirmAction==='guardarNuevo')await guardarYNuevoReal();else if(confirmAction==='limpiar')await limpiarDia();}catch(e){alert(`Error: ${String(e?.message||e)}`);}finally{setGuardandoState(false);cerrarConfirm();}}

function focusNextRowField(rowIdx,currentEl){const filas=[...document.querySelectorAll('#rows .fila')],fila=filas[rowIdx];if(!fila)return false;const inp=[...fila.querySelectorAll('input.inp')],btn=fila.querySelector('.btn-comp'),ord=isMobile()?[inp[1],inp[2],btn,inp[3],inp[0]].filter(Boolean):[...inp,btn].filter(Boolean);const i=ord.indexOf(currentEl),nx=ord[i+1];if(nx){nx.focus();return true;}const nf=filas[rowIdx+1];if(nf){const ni=[...nf.querySelectorAll('input.inp')],f=isMobile()?(ni[1]||ni[2]||ni[0]):ni[0];if(f){f.focus();return true;}}els.nMaquina.focus();return true;}

async function handleCompEnter(e){if(e.key!=='Enter'||!els.panelComp.classList.contains('active'))return;const t=e.target,isIn=t instanceof HTMLInputElement&&t.classList.contains('inp'),isComp=t instanceof HTMLButtonElement&&t.classList.contains('btn-comp'),isAdd=t===document.getElementById('btnAdd');if(!isIn&&!isComp&&!isAdd&&t!==els.btnNuevoComp)return;e.preventDefault();if(t===els.btnNuevoComp){abrirSelectorComp({type:'new'});return;}if(isAdd){await guardarYNuevoReal();return;}if(isComp){const i=Number(t.dataset.row);if(Number.isFinite(i))abrirSelectorComp({type:'row',idx:i});return;}if(t===els.nMaquina){els.nMaquina.value=formatearMaquina(els.nMaquina.value);syncNew().catch(err=>toastErr('Error sincronizando nueva fila',err));els.nMonto.focus();return;}if(t===els.nMonto){els.nMonto.value=fmtMontoCampo(els.nMonto.value);syncNew().catch(err=>toastErr('Error sincronizando nueva fila',err));els.btnNuevoComp.focus();return;}if(t===els.nTransfer){await abrirPickerNuevo();return;}if(t===els.nCliente){syncNew().catch(err=>toastErr('Error sincronizando nueva fila',err));els.nMaquina.focus();return;}if(t===els.nFecha){syncNew().catch(err=>toastErr('Error sincronizando nueva fila',err));els.nHora.focus();return;}if(t===els.nHora){syncNew().catch(err=>toastErr('Error sincronizando nueva fila',err));els.nCliente.focus();return;}const f=t.closest('.fila');if(!f)return;const idx=[...document.querySelectorAll('#rows .fila')].indexOf(f);if(idx<0)return;const ri=[...f.querySelectorAll('input.inp')];if(t===ri[3]){window.pickRowAlias(idx);return;}focusNextRowField(idx,t);}

els.tabAlias.addEventListener('click',()=>activarTab('alias'));els.tabComp.addEventListener('click',()=>activarTab('comp'));els.tabResumen.addEventListener('click',()=>activarTab('resumen'));
document.getElementById('btnAliasAdd').addEventListener('click',()=>addAlias().catch(e=>toastErr('No se pudo guardar alias',e)));
[els.aliasNombreInput,els.aliasAliasInput,els.aliasCuitInput].forEach(inp=>inp.addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();addAlias().catch(err=>toastErr('No se pudo guardar alias',err));}));
document.getElementById('btnAdd').addEventListener('click',()=>guardarYNuevoReal().catch(e=>toastErr('No se pudo guardar y crear nuevo',e)));
els.btnGuardarNuevo.addEventListener('click',()=>abrirConfirm('guardarNuevo'));els.btnLimpiar.addEventListener('click',()=>abrirConfirm('limpiar'));els.btnNuevoComp.addEventListener('click',()=>abrirSelectorComp({type:'new'}));els.btnDiaPrev.addEventListener('click',()=>moverDia(-1));els.btnDiaNext.addEventListener('click',()=>moverDia(1));

els.nTransfer.addEventListener('click',()=>abrirPickerNuevo().catch(e=>toastErr('No se pudo abrir alias',e)));
[els.nMonto,els.nMaquina,els.nTransfer,els.nFecha,els.nHora,els.nCliente].forEach(inp=>{inp.addEventListener('change',()=>syncNew().catch(e=>toastErr('Error sincronizando nueva fila',e)));inp.addEventListener('blur',()=>syncNew().catch(e=>toastErr('Error sincronizando nueva fila',e)));});
els.nMonto.addEventListener('blur',()=>{els.nMonto.value=fmtMontoCampo(els.nMonto.value);});els.nMaquina.addEventListener('blur',()=>{els.nMaquina.value=formatearMaquina(els.nMaquina.value);});
els.panelComp.addEventListener('keydown',e=>{handleCompEnter(e).catch(err=>toastErr('Error de navegación',err));});

els.pickerList.addEventListener('click',e=>{const b=e.target.closest('.picker-item');if(!b)return;const sel=b.getAttribute('data-alias')||'',cb=onPickAlias;cerrarPicker();if(cb)Promise.resolve(cb(sel)).catch(err=>toastErr('No se pudo aplicar alias',err));});
document.getElementById('pickerClose').addEventListener('click',cerrarPicker);els.pickerBg.addEventListener('click',e=>{if(e.target===els.pickerBg)cerrarPicker();});
els.confirmOk.addEventListener('click',()=>avanzarConfirm().catch(e=>toastErr('No se pudo completar acción',e)));els.confirmCancel.addEventListener('click',cerrarConfirm);els.confirmBg.addEventListener('click',e=>{if(e.target===els.confirmBg)cerrarConfirm();});

els.compFileInput.addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(!f||!fileTarget)return;const t=fileTarget;fileTarget=null;aplicarComp(f,t).catch(err=>toastErr('No se pudo tomar el comprobante',err));});
els.panelComp.addEventListener('dragover',e=>{const f=primerArchivoDT(e.dataTransfer);if(!f)return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
els.panelComp.addEventListener('drop',e=>{const f=primerArchivoDT(e.dataTransfer);if(!f)return;e.preventDefault();const t=targetDesdeEl(e.target);aplicarComp(f,t).catch(err=>toastErr('No se pudo subir por arrastre',err));});
document.addEventListener('paste',e=>{if(!els.panelComp.classList.contains('active'))return;const f=primerArchivoCB(e.clipboardData);if(!f)return;e.preventDefault();const t=targetDesdeEl(document.activeElement);aplicarComp(f,t).catch(err=>toastErr('No se pudo pegar comprobante',err));});

async function init(){autocompletarFechaHora();setInterval(autocompletarFechaHora,30000);actualizarBotonNuevoComp();render();activarTab('comp');try{await cargarAliases();}catch(e){toastErr('No se pudieron cargar alias',e);}await cargarRowsHoy();await refrescarResumen();if(isMobile())els.nMaquina.focus();else els.nMonto.focus();}
init().catch(e=>{console.error(e);alert(`Error inicializando: ${String(e.message||e)}`);});
