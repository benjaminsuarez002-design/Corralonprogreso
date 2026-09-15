export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && /^\/pedidos\/[^/]+\/?$/i.test(url.pathname)) {
      const assetUrl = new URL('/pedido-compartido.html', url);
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
