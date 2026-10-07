// One connection per browser profile and origin, independent of the visible tab.
importScripts('vendor/supabase.js');
const ports = new Set();
let client = null, channel = null, config = null, meta = null, metaLoading = null;
let closeTimer = null, subscribed, ready;
function send(port, message) { try { port.postMessage(message); } catch (_) { ports.delete(port); } }
function broadcast(message) { for (const port of ports) send(port, message); }
async function readMeta() {
  if (metaLoading) return metaLoading;
  metaLoading = (async () => {
    const response = await fetch(config.url + '/rest/v1/catalogo_articulos_meta?id=eq.principal&select=*&limit=1', {
      headers: { apikey: config.key, Authorization: 'Bearer ' + config.key }, cache: 'no-store'
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
function start() {
  if (client || !config) return;
  ready = new Promise(resolve => { subscribed = resolve; });
  client = supabase.createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { heartbeatIntervalMs: 25000 },
    global: { headers: { 'x-client-info': 'corralon-shared-catalog' } }
  });
  const ownedClient = client;
  channel = client.channel('catalogo-meta-compartido-v2').on('postgres_changes', {
    event: '*', schema: 'public', table: 'catalogo_articulos_meta', filter: 'id=eq.principal'
  }, payload => {
    if (client !== ownedClient) return;
    meta = payload.new || null;
    broadcast({ type: 'meta', meta });
  }).subscribe(status => {
    if (client !== ownedClient) return;
    broadcast({ type: 'status', status });
    if (status === 'SUBSCRIBED') {
      // Initial connection, or actual reconnection: recover events missed offline once.
      readMeta().catch(error => broadcast({ type: 'error', message: error.message }));
      subscribed();
    }
  });
}
onconnect = event => {
  clearTimeout(closeTimer);
  const port = event.ports[0]; ports.add(port); port.start();
  port.onmessage = async event => {
    const message = event.data || {};
    if (message.type === 'init') {
      if (!config) config = { url: message.url, key: message.key };
      start();
      if (meta) send(port, { type: 'meta', meta });
    }
    if (message.type === 'cache-ready') { for (const other of ports) if (other !== port) send(other, { type: 'cache-ready' }); }
    if (message.type === 'get-meta') {
      try {
        await ready;
        const value = meta || await readMeta();
        send(port, { type: 'reply', requestId: message.requestId, meta: value });
      } catch (error) { send(port, { type: 'reply', requestId: message.requestId, error: error.message }); }
    }
    if (message.type === 'release') {
      ports.delete(port); port.close();
      if (!ports.size) closeTimer = setTimeout(() => {
        if (ports.size) return;
        client?.realtime.disconnect(); client = null; channel = null; meta = null;
      }, 10000);
    }
  };
};
