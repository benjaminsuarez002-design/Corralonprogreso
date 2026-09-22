const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number(String(value).trim().replace(/\./g, '').replace(',', '.'));
const decimal = value => Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const price = value => Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hasSession = () => Boolean(window.CorralonFunciones?.isMenuSessionActive?.());

// The preview and printed sheet share this isolated document; Index's responsive
// table/card rules cannot change the printed layout.
export function cartelDocument(data, logoUrl) {
  const quality = data.calidad ? `${esc(data.calidad)}. CALIDAD` : '';
  const discount = data.descuentoActivo && Number.isFinite(data.descuento) ? Math.max(0, Math.min(100, data.descuento)) : 0;
  const finalM2 = Math.round(data.precioM2 * (1 - discount / 100) * 100) / 100;
  const finalBox = Math.round(data.precioCaja * (1 - discount / 100) * 100) / 100;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cartel ${esc(data.codigo)}</title><style>
    @page{size:A4 landscape;margin:6mm}
    *{box-sizing:border-box}html{font-size:1vw}body{margin:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
    .sheet{width:100rem;height:69.47rem;display:flex;flex-direction:column}
    .banner{height:11.8rem;flex-shrink:0;background:#ad0500;display:flex;align-items:center;justify-content:center}
    .banner img{width:27rem;height:10.8rem;object-fit:contain;filter:brightness(0) invert(1)}
    .body{padding:2.5rem 6rem;flex:1;min-height:0;display:flex;flex-direction:column}
    .identity{display:grid;grid-template-columns:17.3rem 1fr;gap:0;align-items:start;min-height:9rem;font-size:3.55rem;line-height:1.35;font-weight:700}
    .identity code{font:inherit;white-space:nowrap;padding-left:3.2rem}.name{overflow-wrap:anywhere;font-size:var(--name-size,3.55rem)}
    .price-block{flex:1;display:flex;flex-direction:column;justify-content:center;padding:.8rem 0 1.3rem;text-align:center}
    .offer{text-align:center;font-size:3.3rem;line-height:1.15;margin:0 0 .6rem}
    .price{font-size:9.8rem;line-height:1.12;font-weight:700;text-align:center;white-space:nowrap;letter-spacing:-.15rem;margin:0}
    .box{text-align:center;font-size:2.35rem;margin:.8rem 0 .4rem}
    .previous{font-size:2rem;line-height:1.25;color:#555;margin:.3rem 0 0;text-decoration-thickness:1px}
    .footer{border:1px solid #222;display:grid;grid-template-columns:62% 38%;flex-shrink:0}
    .terms{font-size:1.85rem;line-height:1.3;padding:1rem 1.5rem;display:flex;align-items:center;white-space:pre-line}
    .brands{border-left:1px solid #222;display:flex;align-items:center;justify-content:space-evenly;padding:1rem;gap:1rem}
    .naranja{color:#ed651a;font-size:2rem;font-weight:700;white-space:nowrap}.naranja b{font-size:3.5rem;font-style:italic}.visa{color:#1939a4;font-size:3rem;font-style:italic;font-weight:900}
    .master{display:flex;align-items:center;flex-direction:column;font-size:.85rem}.master svg{width:6rem;height:4rem}
    .slogan{border-top:1px solid #222;padding:1rem;text-align:center;font-size:3.2rem;line-height:1.25}
    .quality{border-top:1px solid #222;border-left:1px solid #222;padding:1rem;display:flex;align-items:center;justify-content:center}
    .quality strong{display:block;width:100%;padding:1rem .3rem;background:#ad0500;color:#fff;text-align:center;font-size:3.5rem;white-space:nowrap}
    .footer.no-offer .slogan,.footer.no-offer .quality{border-top:0}
    @media print{html{font-size:2.85mm}body{width:285mm;height:198mm}.sheet{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><main class="sheet">
    <header class="banner"><img src="${esc(logoUrl)}" alt="Corralón Progreso"></header>
    <section class="body">
      <div class="identity"><code>${esc(data.codigo)}</code><div class="name" style="--name-size:${data.descripcion.length > 95 ? '2.7' : data.descripcion.length > 70 ? '3.1' : '3.55'}rem">${esc(data.descripcion)}</div></div>
      <div class="price-block">
        ${data.cuotas ? `<div class="offer">${esc(data.oferta)}</div>` : ''}
        <div class="price"${price(finalM2).length > 9 ? ' style="font-size:8rem"' : ''}>$ ${price(finalM2)} m²</div>
        <div class="box">Precio por caja${discount > 0 ? '' : '/lista'} &nbsp; $ ${price(finalBox)}</div>
        ${discount > 0 ? `<div class="previous"><s>Antes $ ${price(data.precioM2)} m² / caja: $ ${price(data.precioCaja)}</s></div>` : ''}
      </div>
      <footer class="footer${data.cuotas ? '' : ' no-offer'}">
        ${data.cuotas ? `<div class="terms">${esc(data.condiciones)}</div><div class="brands"><span class="naranja"><b>N</b> Naranja</span><span class="visa">VISA</span><span class="master"><svg viewBox="0 0 70 45" aria-label="Mastercard"><circle cx="25" cy="21" r="19" fill="#eb001b"/><circle cx="46" cy="21" r="19" fill="#f79e1b" fill-opacity=".93"/></svg>mastercard</span></div>` : ''}
        <div class="slogan">EL PRECIO QUE BUSCÁS,<br>LO ENCONTRÁS ACÁ</div><div class="quality">${quality ? `<strong>${quality}</strong>` : ''}</div>
      </footer>
    </section>
  </main></body></html>`;
}

export function abrirCartelCeramico({ codigo, descripcion, m2, precioCaja, returnFocus }) {
  if (!hasSession() || document.getElementById('ceramicoCartelEditor')) return;
  if (!document.getElementById('ceramicoCartelStyles')) {
    const style = document.createElement('style');
    style.id = 'ceramicoCartelStyles';
    style.textContent = `
      #ceramicoCartelEditor{position:fixed;inset:0;z-index:2147483600;background:#0008;display:flex;align-items:center;justify-content:center;padding:14px;font-family:Barlow,Arial,sans-serif;color:var(--corralon-black,#111)}
      #ceramicoCartelEditor .cartel-dialog{background:var(--corralon-panel,#fff);border:1px solid var(--corralon-line,#ddd);border-radius:16px;width:min(1020px,100%);max-height:95dvh;overflow:auto;box-shadow:0 20px 65px #0005}
      #ceramicoCartelEditor header,#ceramicoCartelEditor .cartel-actions{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--corralon-soft,#f6f6f4)}
      #ceramicoCartelEditor .cartel-actions{position:sticky;bottom:0;z-index:5;border-top:1px solid var(--corralon-line,#ddd);box-shadow:0 -8px 20px rgba(0,0,0,.12)}
      #ceramicoCartelEditor h2{margin:0;font:900 25px 'Barlow Condensed',Arial,sans-serif}
      #ceramicoCartelEditor .cartel-content{display:grid;grid-template-columns:280px minmax(0,640px);justify-content:center;gap:16px;padding:16px}
      #ceramicoCartelEditor .cartel-fields{display:grid;align-content:start;gap:10px}
      #ceramicoCartelEditor label{display:grid;gap:4px;font-size:14px;font-weight:700}
      #ceramicoCartelEditor input:not([type=checkbox]),#ceramicoCartelEditor textarea,#ceramicoCartelEditor select{width:100%;min-width:0;border:1px solid var(--corralon-line,#bbb);border-radius:7px;padding:7px;font:15px Barlow,Arial,sans-serif;background:#fff;color:#111}
      #ceramicoCartelEditor textarea{resize:vertical;min-height:66px}#ceramicoCartelEditor .cartel-check{display:flex;align-items:center;gap:8px}#ceramicoCartelEditor input[type=checkbox]{width:18px;height:18px;margin:0}
      #ceramicoCartelEditor .cartel-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #ceramicoCartelEditor .cartel-preview{align-self:start;justify-self:center;width:100%;max-width:640px;min-width:0;background:#e9e9e6;padding:8px;border-radius:8px}#ceramicoCartelEditor iframe{display:block;width:100%;height:auto;aspect-ratio:285/198;border:0;background:#fff}
      #ceramicoCartelEditor button{border:1px solid var(--corralon-line,#bbb);border-radius:8px;padding:8px 16px;background:#fff;color:#111;font:700 16px 'Barlow Condensed',Arial;cursor:pointer}
      #ceramicoCartelEditor button[type=submit]{background:var(--corralon-red,#e50914);color:#fff;border-color:transparent}#ceramicoCartelEditor button:disabled{opacity:.5;cursor:wait}
      #ceramicoCartelEditor [hidden]{display:none!important}#ceramicoCartelEditor [data-status]{font-size:13px;color:#666}#ceramicoCartelEditor [data-status].error{color:#c00}
      @media screen and (max-width:800px){#ceramicoCartelEditor .cartel-content{grid-template-columns:1fr}#ceramicoCartelEditor .cartel-dialog{max-height:96dvh}#ceramicoCartelEditor .cartel-preview{max-width:560px}#ceramicoCartelEditor .cartel-actions{padding-bottom:max(12px,env(safe-area-inset-bottom))}}
    `;
    document.head.appendChild(style);
  }
  const overlay = document.createElement('div');
  overlay.id = 'ceramicoCartelEditor';
  overlay.innerHTML = `<form class="cartel-dialog" role="dialog" aria-modal="true" aria-labelledby="cartelTitle">
    <header><h2 id="cartelTitle">Imprimir cartel de cerámico</h2><button type="button" data-close>Cerrar</button></header>
    <div class="cartel-content"><div class="cartel-fields">
      <label>IDArt<input name="codigo" readonly></label>
      <label>Descripción<textarea name="descripcion" required maxlength="160"></textarea></label>
      <div class="cartel-pair"><label>m² por caja<input name="m2" inputmode="decimal" required></label><label>Calidad<select name="calidad"><option value="">Sin indicar</option><option value="1RA">1ra. calidad</option><option value="2DA">2da. calidad</option><option value="3RA">3ra. calidad</option></select></label></div>
      <div class="cartel-pair"><label>Precio por m²<input name="precioM2" inputmode="decimal" required></label><label>Precio por caja<input name="precioCaja" inputmode="decimal" required></label></div>
      <label class="cartel-check"><input name="cuotas" type="checkbox">Incluir oferta de cuotas</label>
      <label class="cartel-check"><input name="descuentoActivo" type="checkbox">Aplicar descuento</label>
      <label data-discount hidden>Descuento %<input name="descuento" inputmode="decimal" value="25"></label>
      <label data-offer hidden>Título de la oferta<input name="oferta" maxlength="65" value="HASTA 5 CUOTAS SIN INTERÉS"></label>
      <label data-offer hidden>Condiciones<textarea name="condiciones" maxlength="160">5 CUOTAS SIN INTERÉS CON NARANJA O 3\nCUOTAS SIN INTERÉS CON TARJETAS BANCARIAS</textarea></label>
    </div><div class="cartel-preview"><iframe title="Vista previa del cartel de cerámico"></iframe></div></div>
    <div class="cartel-actions"><span data-status role="status">A4 horizontal · Los ajustes se aplican solo a este cartel.</span><button type="submit">Imprimir</button></div>
  </form>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form'), fields = form.elements, frame = overlay.querySelector('iframe');
  const status = overlay.querySelector('[data-status]'), printButton = overlay.querySelector('[type=submit]');
  const logoUrl = new URL('logo-corralon.png', document.baseURI).href;
  fields.codigo.value = String(codigo || '');
  fields.descripcion.value = String(descripcion || '').toUpperCase();
  fields.m2.value = m2 > 0 ? decimal(m2) : '';
  fields.precioCaja.value = decimal(precioCaja);
  fields.precioM2.value = m2 > 0 ? decimal(precioCaja / m2) : '';
  fields.calidad.value = /\b(?:2DA|SEGUNDA)\b/i.test(descripcion) ? '2DA' : /\b(?:1RA|PRIMERA)\b/i.test(descripcion) ? '1RA' : '';
  let ready = false;
  const read = () => ({ codigo: fields.codigo.value, descripcion: fields.descripcion.value.trim().toUpperCase(), m2: number(fields.m2.value), precioM2: number(fields.precioM2.value), precioCaja: number(fields.precioCaja.value), calidad: fields.calidad.value, cuotas: fields.cuotas.checked, descuentoActivo: fields.descuentoActivo.checked, descuento: number(fields.descuento.value), oferta: fields.oferta.value.trim(), condiciones: fields.condiciones.value.trim() });
  const refresh = () => {
    ready = false; printButton.disabled = true;
    overlay.querySelectorAll('[data-offer]').forEach(label => { label.hidden = !fields.cuotas.checked; });
    overlay.querySelector('[data-discount]').hidden = !fields.descuentoActivo.checked;
    frame.srcdoc = cartelDocument(read(), logoUrl);
  };
  frame.addEventListener('load', () => { ready = true; printButton.disabled = false; });
  form.addEventListener('input', event => {
    const name = event.target.name, meters = number(fields.m2.value);
    if (meters > 0) {
      if (name === 'precioM2') fields.precioCaja.value = decimal(number(fields.precioM2.value) * meters);
      else if (name === 'precioCaja' || name === 'm2') fields.precioM2.value = decimal(number(fields.precioCaja.value) / meters);
    }
    refresh();
  });
  const close = () => { overlay.remove(); returnFocus?.focus({ preventScroll: true }); };
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll('button,input,textarea,select')].filter(el => !el.disabled && el.getClientRects().length);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!hasSession()) { status.textContent = 'Iniciá sesión para imprimir.'; status.classList.add('error'); return; }
    if (!ready) return;
    const data = read();
    if (data.descuentoActivo && (!Number.isFinite(data.descuento) || data.descuento <= 0 || data.descuento >= 100)) {
      status.textContent = 'Ingresá un descuento mayor que 0 y menor que 100 %.'; status.classList.add('error'); fields.descuento.focus(); return;
    }
    if (![data.m2, data.precioM2, data.precioCaja].every(value => Number.isFinite(value) && value > 0) || !data.descripcion || (data.cuotas && (!data.oferta || !data.condiciones))) {
      status.textContent = 'Revisá los metros, los precios y los textos del cartel.'; status.classList.add('error'); return;
    }
    printButton.disabled = true;
    try {
      const logo = frame.contentDocument.querySelector('img');
      if (logo.decode) await logo.decode();
      if (!overlay.isConnected || !hasSession()) return;
      status.classList.remove('error'); status.textContent = 'A4 horizontal · Escala 100 % · Sin encabezados ni pies del navegador.';
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (error) {
      console.error(error); status.textContent = 'No se pudo preparar la impresión. Intentá nuevamente.'; status.classList.add('error');
    } finally { printButton.disabled = false; }
  });
  refresh();
  overlay.querySelector('[data-close]').focus();
}
