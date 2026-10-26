const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('abrir dos veces conserva el cursor y descarga solamente el JSON posterior',async()=>{
  const shared=fs.readFileSync(path.join(__dirname,'..','corralon-system.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','listasproveedores.html'),'utf8');
  const helper=shared.slice(shared.indexOf('  function providerJsonIsNewer('),shared.indexOf('  function queueProviderCacheReplacement('));
  const sync=html.slice(html.indexOf('    async function syncProviderJsonManifest('),html.indexOf('    async function syncProvidersUpdatedAfterLocalMeta('));
  let local={id:'principal',last_provider_sync_at:'2026-09-30T12:00:05.000Z',provider_json_manifest:{}};
  let downloads=0,toasts=0;
  let entry={id_proveedor:'12',proveedor:'PRUEBA',updated_at:'2026-09-30T12:00:04Z',version:1,total_articulos:115};
  const context={Date,Set,Object,String,Number,console,Promise,setTimeout,
    state:{db:{},worker:{},loaded:true},
    fetchProviderManifest:async()=>({providers:{12:entry}}),
    providerManifestEntries:m=>Object.values(m.providers),
    idbGet:async()=>local,localProviderManifest:m=>m.provider_json_manifest||{},
    saveLocalSyncMeta:async patch=>{local={...local,...patch};},
    setStatus(){},setSyncProgress(){},hideSyncProgress(){},
    fetchProviderJsonRows:async()=>{downloads++;return [{idorden:1}];},
    idbReplaceProviderArticles:async()=>{},replaceProviderInWorker(){},
    idbDeleteProviderArticles:async()=>{},idbClear:async()=>{},
    sortUpdates:x=>x,providerJsonUrls:()=>['https://example.com/list.json'],
    loadCacheIntoWorker:async()=>{},syncToastMessage:()=>'',showToast:()=>toasts++,
    CorralonSystem:{providerCache:{}}
  };
  vm.createContext(context);vm.runInContext(helper,context);
  context.CorralonSystem.providerCache.jsonIsNewer=context.providerJsonIsNewer;
  vm.runInContext(sync,context);
  await context.syncProviderJsonManifest({});await context.syncProviderJsonManifest({});
  assert.equal(downloads,0);assert.equal(toasts,0);
  assert.equal(local.last_provider_sync_at,'2026-09-30T12:00:05.000Z');
  entry={...entry,updated_at:'2026-09-30T12:00:06Z',version:2};
  await context.syncProviderJsonManifest({});
  assert.equal(downloads,1);assert.equal(toasts,1);
  const savedCursor=local.last_provider_sync_at;
  await context.syncProviderJsonManifest({});
  assert.equal(downloads,1);assert.equal(toasts,1);
  assert.equal(local.last_provider_sync_at,savedCursor);
  assert.equal(context.providerJsonIsNewer({...entry,updated_at:savedCursor},savedCursor),false);
});
