const fs = require('fs');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pedidos = fs.readFileSync('pedidos.html', 'utf8');
const shared = fs.readFileSync('pedido-compartido.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker.js', 'utf8');
const uploader = fs.readFileSync('subir_archivos_github.ps1', 'utf8');
const wrangler = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));

for (const [name, html] of [['pedidos.html', pedidos], ['pedido-compartido.html', shared]]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
  scripts.forEach((source, index) => new vm.Script(source, { filename: `${name}:inline-${index + 1}` }));
}

assert(pedidos.includes('id="shareOrderDetailBtn"'), 'Falta el botón Compartir en el detalle del pedido.');
assert(pedidos.includes('https://corralonprogreso.com/pedidos/'), 'El enlace debe usar el dominio público incluso cuando se genera desde localhost.');
assert(!pedidos.includes('await navigator.share('), 'Compartir debe copiar el enlace sin abrir el panel nativo de Windows.');
assert(pedidos.includes("collection('pedidos').doc(docId).set({shareSlug:slug"), 'El enlace debe quedar asociado al pedido original.');
assert(!pedidos.includes("collection('pedidosCompartidos')"), 'No debe crearse una colección duplicada de pedidos compartidos.');
assert(shared.includes("where('shareSlug','==',shareSlug).limit(1)"), 'La vista pública debe consultar únicamente el slug recibido.');
assert(shared.includes("['codigo','articulos','cantidad']"), 'El Excel compartido debe contener código, descripción y cantidad.');
assert(/<div class="row head-row"><div>Código<\/div><div>Descripción<\/div><div class="qty">Cantidad<\/div><\/div>/.test(shared), 'La tabla pública debe limitarse a las tres columnas solicitadas.');
assert(wrangler.main === 'cloudflare-worker.js', 'Wrangler debe publicar el enrutador de pedidos.');
assert(Array.isArray(wrangler.assets?.run_worker_first) && wrangler.assets.run_worker_first.includes('/pedidos/*'), 'Cloudflare debe enviar /pedidos/* al enrutador.');
assert(worker.includes("new URL('/pedido-compartido', url)"), 'La ruta amigable debe pedir el asset canónico sin perder el slug en una redirección.');
assert(uploader.includes("'pedidos.html', 'pedido-compartido.html', 'cloudflare-worker.js', 'wrangler.jsonc', '.assetsignore'"), 'El publicador debe subir junta toda la función de pedidos compartidos.');
assert(pedidos.includes("if(!activeSessionIsAdmin()){notifyNeedsAdmin();els.status.textContent='Necesitás ser administrador para compartir el pedido'"), 'Compartir debe requerir administrador igual que Excel y PDF.');
assert(pedidos.includes("await setHistoryPedido(orderListKey(order),true);renderOrderDetail(order)"), 'Compartir debe marcar el registro como Pedido y actualizar el detalle.');

console.log('Pedido compartido: enlace corto, lectura única y exportaciones limitadas verificados.');
