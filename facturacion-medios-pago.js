(function (root) {
  'use strict';
  const key = id => String(Number(id) || 0);
  const ids = values => [...new Set((Array.isArray(values) ? values : []).map(Number).filter(Number.isInteger))];
  const text = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function normalize(source, catalog) {
    const medios = {};
    const entries = source?.medios && typeof source.medios === 'object' ? source.medios : {};
    for (const [id, value] of Object.entries(entries)) {
      if (!Number(id) || !value || typeof value !== 'object') continue;
      medios[key(id)] = {
        comprobantesExcluidos: ids(value.comprobantesExcluidos),
        tarjetasExcluidas: ids(value.tarjetasExcluidas)
      };
    }
    for (const payment of catalog?.tiposPago || []) {
      const id = key(payment.id), name = text(payment.nombre);
      if (medios[id] || ![3, 5].includes(Number(payment.clase))) continue;
      let compatible = null;
      if (name === 'mercado pago') compatible = new Set(['mp credito', 'mp debito', 'mp qr']);
      if (name === 'transf bria') compatible = new Set(['mp transferencia']);
      if (compatible) medios[id] = {
        comprobantesExcluidos:[],
        tarjetasExcluidas:(catalog.tarjetas || []).filter(card => !compatible.has(text(card.nombre))).map(card => Number(card.id))
      };
    }
    return { version:1, medios };
  }
  const rule = (rules, paymentId) => rules?.medios?.[key(paymentId)] || { comprobantesExcluidos:[], tarjetasExcluidas:[] };
  const allowsVoucher = (rules, paymentId, voucherId) => !(rule(rules, paymentId).comprobantesExcluidos || []).includes(Number(voucherId));
  const allowsCard = (rules, paymentId, cardId) => !(rule(rules, paymentId).tarjetasExcluidas || []).includes(Number(cardId));
  const usesCards = payment => [3, 5].includes(Number(payment?.clase));
  function adjustValue(row, source, parse = Number, round = value => Math.round((value + Number.EPSILON) * 100) / 100) {
    if (source === 'total') {
      const target = round(parse(row.total));
      if (!parse(row.importe)) { row.importe = target; row.impRec = 0; row.coef = 0; }
      else { row.impRec = round(target - parse(row.importe)); row.coef = parse(row.impRec) / parse(row.importe); }
    } else if (source === 'impRec') row.coef = parse(row.importe) ? parse(row.impRec) / parse(row.importe) : 0;
    else row.impRec = round(parse(row.importe) * parse(row.coef));
    row.total = round(parse(row.importe) + parse(row.impRec));
    return row;
  }
  root.CorralonMediosPago = { normalize, rule, allowsVoucher, allowsCard, usesCards, adjustValue };
})(typeof window !== 'undefined' ? window : globalThis);
