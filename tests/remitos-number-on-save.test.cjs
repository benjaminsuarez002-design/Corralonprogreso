const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('remitos.html','utf8');
test('automático vacío consulta al guardar; excluye manuales y el salto conocido',async()=>{
 let calls=0;
 const records=[{nro:'0001-00000208',numero_manual:false},{nro:'0001-00999999',numero_manual:true},{nro:'0001-00748370',numero_manual:false}];
 const box={SUPABASE_URL:'https://example.test',SUPABASE_KEY:'test',remitoShort:n=>String(n).padStart(8,'0'),fetch:async url=>{
  calls++;const query=new URL(url).searchParams;assert.equal(query.get('numero_manual'),'eq.false');assert.equal(query.get('nro'),'neq.0001-00748370');assert.equal(query.get('limit'),'1');
  return {ok:true,json:async()=>records.filter(r=>!r.numero_manual&&r.nro!=='0001-00748370').slice(-1)};
 }};
 vm.createContext(box);vm.runInContext(html.slice(html.indexOf('async function contarRemitosGuardados()'),html.indexOf('// ── NÚMERO DE REMITO DESDE SUPABASE'))+html.slice(html.indexOf('async function resolverNumeroRemito('),html.indexOf('// ── GUARDAR EN SUPABASE')),box);
 assert.equal(calls,0);assert.equal(await box.resolverNumeroRemito({nro:'71816',numero_manual:true}),'00071816');assert.equal(calls,0);
 assert.equal(await box.resolverNumeroRemito({nro:'',numero_manual:false}),'00000209');assert.equal(calls,1);
 box.fetch=async()=>{throw Error('Offline')};await assert.rejects(box.resolverNumeroRemito({nro:'',numero_manual:false}),/Offline/);
 assert(!html.includes('iniciarAutoRefreshNroRemito'));assert(!html.includes('refrescarNroRemitoSiCorresponde'));
});
test('sintaxis de Remitos y Facturación',()=>{
 for(const file of ['remitos.html','gestion.html'])for(const m of fs.readFileSync(file,'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/src=/.test(m[1])&&m[2].trim())new vm.Script(m[2].replace(/^import .*$/gm,''));
});
