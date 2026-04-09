(function () {
  const logoCache = new Map();

  function fmtMoneda(n) {
    return '$ ' + Number(n || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function normalizarFecha(fecha) {
    if (!fecha) return '-';
    if (typeof fecha !== 'string') return String(fecha);
    const parsed = new Date(fecha);
    return Number.isNaN(parsed.getTime()) ? fecha : parsed.toLocaleDateString('es-AR');
  }

  function ensureLogoDataUrl(url) {
    if (!url) return Promise.resolve(null);
    if (logoCache.has(url)) return logoCache.get(url);

    const promise = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          console.warn('No se pudo convertir el logo a data URL:', e);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });

    logoCache.set(url, promise);
    return promise;
  }

  function sanitizeTitlePart(value) {
    return String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function openPdfPreview(doc, title, filename) {
    const pdfBlob = doc.output('blob', { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const popup = window.open('', '_blank');
    if (!popup) {
      window.open(pdfUrl, '_blank');
      return;
    }

    const safeTitle = sanitizeTitlePart(title) || 'Vista previa PDF';
    const safeFilename = (sanitizeTitlePart(filename || title) || 'documento') + '.pdf';
    popup.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    html, body { height: 100%; margin: 0; background: #111; font-family: Arial, sans-serif; }
    body { display: flex; flex-direction: column; }
    .bar {
      height: 52px;
      background: #1c1c1c;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 0 14px;
      flex: 0 0 auto;
    }
    .title {
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 0 0 auto;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 8px;
      padding: 9px 12px;
      background: #fff;
      color: #111;
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
    }
    iframe { width: 100%; height: calc(100% - 52px); border: 0; background: #fff; flex: 1 1 auto; }
  </style>
</head>
<body>
  <div class="bar">
    <div class="title">${safeTitle}</div>
    <div class="actions">
      <a class="btn" href="${pdfUrl}" download="${safeFilename}">Descargar PDF</a>
    </div>
  </div>
  <iframe src="${pdfUrl}" title="${safeTitle}"></iframe>
</body>
</html>`);
    popup.document.close();
    popup.addEventListener('beforeunload', () => URL.revokeObjectURL(pdfUrl), { once: true });
  }

  function drawPageHeader(doc, opts) {
    if (opts.logoDataUrl) doc.addImage(opts.logoDataUrl, 'PNG', 20, 12, 50, 20);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(18);
    doc.text('CORRALON PROGRESO', 105, 24, { align: 'center' });

    doc.setFontSize(11);
    if (opts.subtitle) {
      doc.text(opts.subtitle, 105, 34, { align: 'center' });
    }
    doc.text((opts.numberLabel || 'Pedido Nro: ') + (opts.numero || '-'), 15, 42);
    doc.text('Fecha: ' + normalizarFecha(opts.fecha), 195, 42, { align: 'right' });
    doc.line(15, 49, 195, 49);
  }

  function drawTableHeader(doc, y, columns) {
    doc.setFillColor(230, 230, 230);
    doc.rect(15, y - 6, 180, 8, 'F');
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.text('Cantidad', columns.cantidad, y);
    doc.text('Descripcion', columns.descripcion, y);
    doc.text(columns.codigoLabel || 'IDArt', columns.codigo, y);
    doc.text('Prec. Uni.', columns.precio, y, { align: 'right' });
    doc.text(columns.importeLabel || 'Importe', columns.importe, y, { align: 'right' });
    y += 4;
    doc.line(15, y, 195, y);
    return y + 7;
  }

  function generarPDFDocumentoBase(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const items = Array.isArray(data.items) ? data.items : [];
    const total = Number(
      data.total ?? items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio) || 0), 0)
    ) || 0;
    const pageH = doc.internal.pageSize.getHeight();
    const footerY = pageH - 20;
    const rowLimitY = footerY - 18;
    const columns = {
      cantidad: 17,
      descripcion: 35,
      codigo: 116,
      precio: 153,
      importe: 191,
      codigoLabel: data.codigoLabel || 'IDArt',
      importeLabel: data.importeLabel || 'Importe'
    };

    drawPageHeader(doc, data);
    let y = drawTableHeader(doc, 61, columns);

    items.forEach((rawItem) => {
      if (y > rowLimitY) {
        doc.addPage();
        drawPageHeader(doc, data);
        y = drawTableHeader(doc, 61, columns);
      }

      const item = {
        cantidad: Number(rawItem.cantidad) || 0,
        nombre: String(rawItem.nombre || rawItem.descripcion || rawItem.desc || ''),
        codigo: String(rawItem.codigo || ''),
        precio: Number(rawItem.precio) || 0
      };
      const subtotal = item.cantidad * item.precio;

      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      doc.text(item.cantidad.toFixed(2), columns.cantidad, y);
      doc.text(item.nombre.substring(0, 34), columns.descripcion, y);
      doc.text(item.codigo.substring(0, 10), columns.codigo, y);
      doc.text(fmtMoneda(item.precio), columns.precio, y, { align: 'right' });
      doc.text(fmtMoneda(subtotal), columns.importe, y, { align: 'right' });
      y += 8;
    });

    doc.line(15, footerY - 6, 195, footerY - 6);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(13);
    doc.text('TOTAL: ' + fmtMoneda(total), 195, footerY, { align: 'right' });
    return doc;
  }

  function generarPDFPresupuestoDoc(data) {
    return generarPDFDocumentoBase({
      ...data,
      subtitle: data.subtitle || 'Presupuesto a clientes',
      numberLabel: data.numberLabel || data.etiquetaNumero || 'Pedido Nro: ',
      importeLabel: 'Importe',
      codigoLabel: 'IDArt'
    });
  }

  function generarPDFRemitoDoc(data) {
    return generarPDFDocumentoBase({
      ...data,
      subtitle: data.subtitle || 'Remito a proveedores',
      numberLabel: data.numberLabel || 'Nro Remito: ',
      importeLabel: 'Importe',
      codigoLabel: 'IDArt'
    });
  }

  window.PresupuestoShared = {
    ensureLogoDataUrl,
    openPdfPreview,
    generarPDFPresupuestoDoc,
    generarPDFRemitoDoc
  };
})();
