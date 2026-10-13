// One connection per browser profile and origin, independent of the visible tab.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js');
const ports = new Set();
let unsubscribe = null, config = null, meta = null, metaLoading = null;
let closeTimer = null, ready, resolveReady, signalVersion = -1, pendingVersion = -1, refreshTask = null;
let traceSequence = 0;
const traceWorker = Math.random().toString(16).slice(2);
function send(port, message) { try { port.postMessage(message); } catch (_) { ports.delete(port); } }
function broadcast(message) { for (const port of ports) send(port, message); }
async function readMeta() {
  if (metaLoading) return metaLoading;
  metaLoading = (async () => {
    const response = await fetch(config.url + '/rest/v1/catalogo_articulos_meta?id=eq.principal&select=*&limit=1', {
      headers: { apikey: config.key, Authorization: 'Bearer ' + config.key,
        'x-client-info': `${config.traceIdentity || 'corralon-catalog/1;page=unknown'};worker=${traceWorker};caller=firebase-version;request=${++traceSequence}` }, cache: 'no-store'
    });
    if (!response.ok) throw new Error('Versión del catálogo: HTTP ' + response.status);
    const rows = await response.json();
    const fetched = rows[0] || null;
    if (!meta || (Number(fetched?.version || 0) >= Number(meta.version || 0) && Number(fetched?.patch_version || 0) >= Number(meta.patch_version || 0) && Number(fetched?.ranking_version || 0) >= Number(meta.ranking_version || 0))) meta = fetched;
    broadcast({ type: 'meta', meta });
    return meta;
  })().finally(() => { metaLoading = null; });
  return metaLoading;
}
function receiveVersion(version) {
  pendingVersion = Math.max(pendingVersion, version);
  if (refreshTask || signalVersion >= pendingVersion) return;
  refreshTask = (async () => {
    while (signalVersion < pendingVersion) {
      const target = pendingVersion;
      await readMeta();
      signalVersion = target;
    }
  })().catch(error => broadcast({ type: 'error', message: error.message }))
    .finally(() => { refreshTask = null; resolveReady?.(); });
}
function start() {
  if (unsubscribe || !config) return;
  ready = new Promise(resolve => { resolveReady = resolve; });
  const app = firebase.apps.find(item => item.options.projectId === 'corralon-progreso')
    || firebase.initializeApp({ apiKey: 'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0', projectId: 'corralon-progreso' }, 'catalogo-version');
  unsubscribe = app.firestore().doc('configuracion/catalogo_version').onSnapshot(snapshot => {
    if (snapshot.metadata?.fromCache) return;
    broadcast({ type: 'status', status: 'SUBSCRIBED' });
    receiveVersion(Number(snapshot.exists ? snapshot.data().version || 0 : 0));
  }, error => { broadcast({ type: 'error', message: error.message }); resolveReady?.(); });
}
onconnect = event => {
  clearTimeout(closeTimer);
  const port = event.ports[0]; ports.add(port); port.start();
  port.onmessage = async event => {
    const message = event.data || {};
    if (message.type === 'init') {
      if (!config) config = { url: message.url, key: message.key, traceIdentity: message.traceIdentity };
      start();
      if (meta) send(port, { type: 'meta', meta });
    }
    if (message.type === 'cache-ready') { for (const other of ports) if (other !== port) send(other, { type: 'cache-ready' }); }
    if (message.type === 'get-meta') {
      try {
        await ready;
        const value = metaLoading ? await metaLoading : meta;
        if (!value) throw new Error('No se pudo obtener la versión en la conexión compartida');
        send(port, { type: 'reply', requestId: message.requestId, meta: value });
      } catch (error) { send(port, { type: 'reply', requestId: message.requestId, error: error.message }); }
    }
    if (message.type === 'release') {
      ports.delete(port); port.close();
      if (!ports.size) closeTimer = setTimeout(() => {
        if (ports.size) return;
        unsubscribe?.(); unsubscribe = null; meta = null; signalVersion = -1; pendingVersion = -1;
      }, 10000);
    }
  };
};
