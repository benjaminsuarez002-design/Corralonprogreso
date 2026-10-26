const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const source=fs.readFileSync('tmp/saldos-proveedores-export/publish_saldos_proveedores.js','utf8');
const hash=rows=>crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>Object.fromEntries(Object.entries(r).sort())))).digest('hex');
const row=(id,saldo)=>({id,idProveedor:'1',saldo});
async function publisherTest(){
  let rows=[row('a',10),row('b',20)],remote={version:10,source_hash:hash(rows),notified_version:10,metadata:{count:2}},input={generatedAt:'2026-10-01T12:00:00Z',rows:[row('a',15),row('c',30)]},files={},calls=[],failFirebase=false;
  const mockFs={existsSync:()=>true,readFileSync(file){if(file.endsWith('saldos_proveedores.json'))return JSON.stringify(input);if(files[file])return files[file];throw Error('missing')},writeFileSync(file,data){files[file]=data},renameSync(a,b){files[b]=files[a];delete files[a]}};
  const response=(data,status=200)=>({ok:status<300,status,text:async()=>JSON.stringify(data),json:async()=>data});
  const context={require:name=>name==='fs'?mockFs:require(name),module:{exports:{}},process:{argv:['node','test','--dir','/fake'],stdout:{write(){}},stderr:{write(){}},exitCode:0},__dirname:'/fake',console,fetch:async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body,method:options.method||'GET'});
    if(url.includes('firestore')){if(!options.method)return response({fields:{},updateTime:'now'});if(failFirebase)return response({},500);return response({});}
    if(body.action==='state')return response(remote);
    if(body.action==='read')return response({version:remote.version,rows,deleted:[],reset:true});
    if(body.action==='apply'){
      assert.equal(body.expected,remote.version);const map=new Map(rows.map(r=>[r.id,r]));body.rows.forEach(r=>map.set(r.id,r));body.deleted.forEach(id=>map.delete(id));rows=[...map.values()];remote={...remote,version:remote.version+1,source_hash:body.hash,metadata:body.metadata};return response(remote);
    }
    if(body.action==='ack'){remote.notified_version=body.version;return response([]);}
    throw Error('unexpected');
  }};
  vm.runInNewContext(source,context);const main=context.module.exports.main;
  await main();const apply=calls.find(c=>c.body?.action==='apply').body;
  assert.deepEqual(JSON.parse(JSON.stringify(apply.rows)),[row('a',15),row('c',30)]);assert.deepEqual(JSON.parse(JSON.stringify(apply.deleted)),['b']);
  calls=[];input.version=999;input.generatedAt='2026-10-01T13:00:00Z';await main();assert.equal(calls.length,1);assert.equal(calls[0].body.action,'state');
  input.rows=[row('a',16),row('c',30)];failFirebase=true;await assert.rejects(main(),/Firebase config/);
  assert.notEqual(remote.notified_version,remote.version);calls=[];failFirebase=false;await main();assert(!calls.some(c=>c.body?.action==='apply'));assert.equal(remote.notified_version,remote.version);
  input.rows=[row('a',17),row('c',30)];files={};calls=[];await main();assert(calls.some(c=>c.body?.action==='read'));assert.equal(calls.find(c=>c.body?.action==='apply').body.rows.length,1);
}
async function browserTest(){
  const html=fs.readFileSync('comprobantes.html','utf8');
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/type\s*=\s*["']module/.test(m[1]))new vm.Script(m[2]);
  const normalize=html.slice(html.indexOf('function normalizeSupplierBalancesPayload'),html.indexOf('async function restoreSupplierBalancesCache'));
  const sync=html.slice(html.indexOf('let supplierBalancesSyncQueue'),html.indexOf('function subscribeSupplierBalances'));
  let writes=0,fail=false,requests=[];
  const state={supplierBalances:{protocol:'sql-delta-v1',version:10,count:2,rows:[row('a',10),row('b',20)]}};
  const ctx={state,providerId:String,window:{CorralonSystem:{SUPABASE_URL:'https://test',headers:()=>({})}},renderAliases(){},writeSupplierBalancesCache:async()=>{if(fail)throw Error('disk');writes++},fetch:async(url,opts)=>{
    requests.push(JSON.parse(opts.body));return {ok:true,json:async()=>({version:11,reset:false,metadata:{count:2},rows:[row('a',15),row('c',30)],deleted:['b']})};
  }};
  vm.runInNewContext(normalize+sync,ctx);await ctx.downloadSupplierBalances({protocol:'sql-delta-v1',version:11});
  assert.equal(requests[0].since,10);assert.deepEqual(JSON.parse(JSON.stringify(state.supplierBalances.rows)),[{id:'a',idProveedor:'1',fechaVto:'',nroFactura:'',saldo:15},{id:'c',idProveedor:'1',fechaVto:'',nroFactura:'',saldo:30}]);
  await ctx.downloadSupplierBalances({protocol:'sql-delta-v1',version:11});assert.equal(requests.length,1);
  state.supplierBalances.version=10;fail=true;await assert.rejects(ctx.downloadSupplierBalances({protocol:'sql-delta-v1',version:11}),/disk/);assert.equal(state.supplierBalances.version,10);
  fail=false;await ctx.downloadSupplierBalances({protocol:'sql-delta-v1',version:11});assert.equal(state.supplierBalances.version,11);assert.equal(writes,2);
}
(async()=>{await publisherTest();await browserTest();console.log('PASS: altas/cambios/bajas, sin cambios sin aviso, reintento Firebase, otra PC sin cache, merge IndexedDB y fallo sin avanzar cursor');})().catch(e=>{console.error(e);process.exitCode=1});
