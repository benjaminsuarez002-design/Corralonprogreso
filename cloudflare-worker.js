export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && /^\/pedidos\/[^/]+\/?$/i.test(url.pathname)) {
      // Pedimos la URL canónica del asset para que Cloudflare no responda con
      // una redirección que reemplace /pedidos/<slug> y haga perder la clave.
      const assetUrl = new URL('/pedido-compartido', url);
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
    return env.ASSETS.fetch(request);
  }
};
