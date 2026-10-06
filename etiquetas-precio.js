(() => {
  'use strict';
  const status = document.getElementById('status');
  const printButton = document.getElementById('print');
  const downloadButton = document.getElementById('download');
  const preview = document.getElementById('preview');
  let pdfUrl;
  try {
    const lote = new URLSearchParams(location.search).get('lote');
    if (!lote || !/^[a-zA-Z0-9-]+$/.test(lote)) throw new Error('No se recibió una selección de artículos.');
    const data = JSON.parse(localStorage.getItem(`corralon_etiquetas_${lote}`) || 'null');
    if (!data || !Array.isArray(data.items) || !data.items.length) throw new Error('No se encontró la selección. Volvé al carrito y confirmá las etiquetas.');
    const count = data.items.reduce((sum, item) => {
      if (!item.codigo || !item.nombre || !Number.isFinite(item.precio) || item.precio < 0 || !Number.isInteger(item.cantidad) || item.cantidad < 1) {
        throw new Error('Los artículos deben tener código, descripción, precio y una cantidad entera de etiquetas.');
      }
      return sum + item.cantidad;
    }, 0);
    if (count > 1600) throw new Error('El máximo por PDF es de 1.600 etiquetas.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
    doc.setProperties({ title: 'Etiquetas de precio', subject: 'A5 horizontal · etiquetas de 5 × 3 cm' });
    const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // A5 horizontal: 210 × 148 mm; 4 columnas y 4 filas de 50 × 30 mm.
    const left = (doc.internal.pageSize.getWidth() - 200) / 2;
    const top = (doc.internal.pageSize.getHeight() - 120) / 2;
    let index = 0;
    function fittedText(value, maxSize, minSize, width) {
      let size = maxSize;
      doc.setFontSize(size);
      while (size > minSize && doc.getTextWidth(value) > width) {
        size -= 0.25;
        doc.setFontSize(size);
      }
      return Math.min(width, doc.getTextWidth(value));
    }
    for (const item of data.items) {
      for (let copy = 0; copy < item.cantidad; copy++, index++) {
        if (index && index % 16 === 0) doc.addPage('a5', 'landscape');
        const cell = index % 16;
        const x = left + (cell % 4) * 50;
        const y = top + Math.floor(cell / 4) * 30;
        doc.setDrawColor(130);
        doc.setLineWidth(0.15);
        doc.rect(x, y, 50, 30);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        const description = String(item.nombre).trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-AR');
        let size = 11.5;
        let lines;
        do {
          doc.setFontSize(size);
          lines = doc.splitTextToSize(description, 46);
          if (lines.length * size * 0.3528 * 1.05 <= 17) break;
          size -= 0.25;
        } while (size > 4);
        doc.text(lines, x + 2, y + 2, { baseline: 'top', lineHeightFactor: 1.05 });
        const code = String(item.codigo);
        fittedText(code, 9, 5, 46);
        doc.text(code, x + 2, y + 26.5, { maxWidth: 46 });
        const codeWidth = Math.min(46, doc.getTextWidth(code));
        const price = money.format(item.precio).replace(/\s/g, ' ');
        // El precio comparte el renglón inferior con el ID; se ajusta sin recortar cifras.
        const priceWidth = Math.max(15, 44 - codeWidth);
        fittedText(price, 17, 5, priceWidth);
        doc.text(price, x + 48, y + 26.5, { align: 'right', maxWidth: priceWidth });
      }
    }
    pdfUrl = URL.createObjectURL(doc.output('blob'));
    preview.src = pdfUrl;
    status.textContent = `${count} etiquetas · ${Math.ceil(count / 16)} hojas A5 horizontales · 5 × 3 cm. Imprimí al 100 %, sin ajustar a página.`;
    downloadButton.disabled = false;
    downloadButton.onclick = () => doc.save('Etiquetas-precio-A5.pdf');
    preview.onload = () => { printButton.disabled = false; };
    printButton.onclick = () => {
      try { preview.contentWindow.focus(); preview.contentWindow.print(); }
      catch (_) { window.open(pdfUrl, '_blank'); }
    };
    window.addEventListener('pagehide', () => URL.revokeObjectURL(pdfUrl), { once: true });
  } catch (error) {
    status.textContent = error.message || 'No se pudo generar el PDF.';
  }
})();
