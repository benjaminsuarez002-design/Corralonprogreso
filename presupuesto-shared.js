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

    // Prioridad formato local: dd/mm/yyyy (o d/m/yy, con / o -)
    const m = fecha.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (m) {
      const dia = Number(m[1]);
      const mes = Number(m[2]);
      let anio = Number(m[3]);
      if (anio < 100) anio += 2000;
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
        return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
      }
    }

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
    const headerName = String(opts.headerName || 'CORRALON PROGRESO').trim() || 'CORRALON PROGRESO';
    if (opts.logoDataUrl) doc.addImage(opts.logoDataUrl, 'PNG', 20, 12, 50, 20);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(18);
    doc.text(headerName.substring(0, 38), 105, 24, { align: 'center' });

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
    const footerNote = data.footerNote ? String(data.footerNote) : '';
    const footerLines = footerNote ? footerNote.split(/\r?\n/).filter(Boolean) : [];
    const rowLimitY = footerY - (footerLines.length ? 18 + (footerLines.length * 6) : 18);
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
      const item = {
        cantidad: Number(rawItem.cantidad) || 0,
        nombre: String(rawItem.nombre || rawItem.descripcion || rawItem.desc || ''),
        codigo: String(rawItem.codigo || ''),
        precio: Number(rawItem.precio) || 0
      };
      const subtotal = item.cantidad * item.precio;
      const rowPitch = 4.8;
      const lineHeightFactor = 1.36;

      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(item.nombre || '-', columns.codigo - columns.descripcion - 5);
      const rowH = Math.max(1, lines.length) * rowPitch + 0.8;

      if (y + rowH > rowLimitY) {
        doc.addPage();
        drawPageHeader(doc, data);
        y = drawTableHeader(doc, 61, columns);
      }

      doc.text(item.cantidad.toFixed(2), columns.cantidad, y);
      doc.text(lines, columns.descripcion, y, { lineHeightFactor });
      doc.text(item.codigo.substring(0, 10), columns.codigo, y);
      doc.text(fmtMoneda(item.precio), columns.precio, y, { align: 'right' });
      doc.text(fmtMoneda(subtotal), columns.importe, y, { align: 'right' });
      doc.setDrawColor(175, 175, 175);
      doc.setLineWidth(0.18);
      const dividerY = y + (Math.max(1, lines.length) * rowPitch) - (rowPitch * 0.7);
      doc.line(15, dividerY, 195, dividerY);
      y += rowH;
    });

    doc.line(15, footerY - 6, 195, footerY - 6);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(13);
    doc.text('TOTAL: ' + fmtMoneda(total), 195, footerY, { align: 'right' });
    if (footerLines.length) {
      doc.setFontSize(9);
      doc.text(footerLines, 105, footerY + 8, { align: 'center', lineHeightFactor: 1.25 });
    }
    return doc;
  }

  function generarPDFPresupuestoDoc(data) {
    return generarPDFDocumentoBase({
      ...data,
      headerName: data.headerName || data.tipo || 'Presupuesto web',
      subtitle: data.subtitle || 'Presupuesto a clientes',
      numberLabel: data.numberLabel || data.etiquetaNumero || 'Pedido Nro: ',
      footerNote: data.footerNote || 'Los precios y el total ya tienen todos los impuestos incluidos',
      importeLabel: 'Importe',
      codigoLabel: 'IDArt'
    });
  }

  function generarPDFRemitoDoc(data) {
    return generarPDFDocumentoBase({
      ...data,
      headerName: data.headerName || data.cliente || 'CORRALON PROGRESO',
      subtitle: data.subtitle || 'Remito a proveedores',
      numberLabel: data.numberLabel || 'Nro Remito: ',
      footerNote: data.footerNote || 'Los precios y el total ya tienen todos los impuestos incluidos',
      importeLabel: 'Importe',
      codigoLabel: 'IDArt'
    });
  }

  function formatPedidoCantidad(value) {
    if (typeof value === 'string' && value.trim()) return value.trim().replace('.', ',');
    const num = Number(value) || 0;
    return Number.isInteger(num)
      ? String(num)
      : num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }

  function drawPedidoHeader(doc, data) {
    const proveedor = String(data.proveedor || data.headerName || '-').trim() || '-';
    const sucursal = String(data.sucursal || 'Sin sucursal').trim() || 'Sin sucursal';
    if (data.logoDataUrl) doc.addImage(data.logoDataUrl, 'PNG', 15, 10, 34, 18);

    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.text('PEDIDO PARA', 105, 17, { align: 'center' });
    doc.setFontSize(17);
    doc.text(proveedor.substring(0, 42), 105, 30, { align: 'center' });
    doc.setFontSize(11);
    doc.text(sucursal.substring(0, 50), 105, 40, { align: 'center' });

    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.text(`Pedido Nro: ${data.numero || '-'}`, 195, 16, { align: 'right' });
    doc.text(`Fecha: ${normalizarFecha(data.fecha)}`, 195, 23, { align: 'right' });
    doc.line(15, 48, 195, 48);
  }

  function drawPedidoTableHeader(doc, y) {
    doc.setFillColor(232, 244, 255);
    doc.rect(15, y - 6, 180, 9, 'F');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text('CODPROV', 18, y);
    doc.text('DETALLE', 48, y);
    doc.text('CANTIDAD', 193, y, { align: 'right' });
    doc.setDrawColor(170, 215, 255);
    doc.line(15, y + 4, 195, y + 4);
    return y + 8;
  }

  function generarPDFPedidoDoc(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const items = Array.isArray(data.items) ? data.items : [];
    const pageH = doc.internal.pageSize.getHeight();
    const bottomY = pageH - 18;

    drawPedidoHeader(doc, data);
    let y = drawPedidoTableHeader(doc, 61);

    items.forEach((rawItem) => {
      const codigo = String(rawItem.codigoProveedor || rawItem.codProv || rawItem.codigo || '').trim();
      const detalle = String(rawItem.detalle || rawItem.articulo || rawItem.descripcion || '').trim();
      const cantidad = formatPedidoCantidad(rawItem.cantidad);
      const lines = doc.splitTextToSize(detalle || '-', 118);
      const rowPitch = 4.8;
      const lineHeightFactor = 1.36;
      const rowH = Math.max(rowPitch, lines.length * rowPitch);

      if (y + rowH > bottomY) {
        doc.addPage();
        drawPedidoHeader(doc, data);
        y = drawPedidoTableHeader(doc, 61);
      }

      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      const codeSize = codigo.length > 10 ? Math.max(6.8, 10 - ((codigo.length - 10) * 0.35)) : 10;
      doc.setFontSize(codeSize);
      doc.text(codigo, 18, y, { maxWidth: 24 });
      doc.setFontSize(10);
      doc.text(lines, 48, y, { lineHeightFactor });
      doc.text(cantidad, 193, y, { align: 'right' });
      doc.setDrawColor(175, 175, 175);
      doc.setLineWidth(0.18);
      doc.line(15, y + rowH - (rowPitch * 0.7), 195, y + rowH - (rowPitch * 0.7));
      y += rowH;
    });

    if (!items.length) {
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      doc.text('Este pedido no tiene articulos.', 15, y);
    }

    return doc;
  }

  window.PresupuestoShared = {
    ensureLogoDataUrl,
    openPdfPreview,
    generarPDFPresupuestoDoc,
    generarPDFRemitoDoc,
    generarPDFPedidoDoc
  };
})();
