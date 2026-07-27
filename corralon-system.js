(function () {
  const SUPABASE_URL = 'https://tizyjenayrcdkcodsjnc.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpenlqZW5heXJjZGtjb2Rzam5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzE4MDYsImV4cCI6MjA4NzgwNzgwNn0.Xue8zgo8QJiKTErtzfUOgpczMngsAaePJZqLvA8Z7oI';
  const TABLES = {
    providers: 'proveedores',
    providersMeta: 'proveedores_meta',
    priceList: 'lista_precios',
    priceListMeta: 'lista_precios_meta',
    priceListJsonProviders: 'listas_json_proveedores',
    catalog: 'catalogo_articulos',
    catalogMeta: 'catalogo_articulos_meta'
  };
  const PROVIDERS_DB = 'proveedores_cache_v1';
  const CLOUDINARY_RAW_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/do0i2da7h/raw/upload';
  const CLOUDINARY_UPLOAD_PRESET = 'Corralon';
  const PROVIDER_MANIFEST_PREFIX = 'provider_manifest:';
  const FULL_PROVIDER_MANIFEST_PREFIX = 'provider_full_manifest:';
  const CLOUDINARY_JSON_MAX_BYTES = 8 * 1024 * 1024;
  const IMAGE_GENERATOR_CATALOG_KEY = 'corralon_image_generator_catalog_v1';
  const IMAGE_GENERATOR_PAYLOAD_KEY = 'corralon_image_generator_payload_v1';
  const BRANCHES = [
    { id: 'progreso_ruta', label: 'Suc. Progreso y Ruta' },
    { id: 'calle5_espana', label: 'Suc. Calle 5 y Espana' }
  ];
  const BRANCH_STOCK_FIELDS = {
    progreso_ruta: ['stockSucursalProgresoRuta', 'stock_sucursal_progreso_ruta', 'stock_progreso_ruta', 'stockSucProgresoRuta', 'stockSuc1'],
    calle5_espana: ['stockSucursalCalle5Espana', 'stock_sucursal_calle5_espana', 'stock_calle5_espana', 'stockSucCalle5Espana', 'stockSuc2']
  };
  let articleEditorHost = null;
  let articleEditorReturnFocus = null;
  let articleEditorAdapter = {};
  let articleEditorOriginalCode = '';
  let articleEditorImages = [];
  let articleEditorImageIndex = 0;
  let articleEditorImageFiles = new Map();
  let articleEditorApplyTargets = new Set();
  let articleEditorApplyFields = new Set(['etiquetas']);
  let articleEditorFunctionsBound = false;
  let articleEditorBasePrice = 0;

  function articleCode(article = {}) {
    return String(article.codigo ?? article.idart ?? article.idArt ?? '').trim();
  }

  function articleImages(article = {}) {
    const values = [];
    const add = (value) => {
      if (Array.isArray(value)) return value.forEach(add);
      const text = String(value || '').trim();
      if (text) values.push(text);
    };
    add(article.imagenes);
    add(article.fotos);
    add(article.fotoUrl);
    add(article.imagen);
    return [...new Set(values)];
  }

  function articleTags(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
    return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  function articleBool(value) {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'si', 'sí', 'on'].includes(String(value ?? '').trim().toLowerCase());
  }

  function editorField(id) {
    return articleEditorHost?.querySelector(`[data-editor-field="${id}"]`);
  }

  function editorInfo(id) {
    return articleEditorHost?.querySelector(`[data-editor-info="${id}"]`);
  }

  function syncArticleEditorSections() {
    const offer = articleEditorHost?.querySelector('[data-editor-extra="oferta"]');
    const ceramic = articleEditorHost?.querySelector('[data-editor-extra="ceramico"]');
    if (offer) offer.hidden = !articleEditorHost.querySelector('[data-editor-chip="oferta"]')?.classList.contains('is-active');
    if (ceramic) ceramic.hidden = !articleEditorHost.querySelector('[data-editor-chip="ceramico"]')?.classList.contains('is-active');
    renderArticleEditorPrice();
  }

  function renderArticleEditorPrice() {
    if (!articleEditorHost) return;
    const value = editorInfo('precio');
    const state = editorInfo('precioEstado');
    const previous = editorInfo('precioAnterior');
    if (!value || !state || !previous) return;
    const offerActive = articleEditorHost.querySelector('[data-editor-chip="oferta"]')?.classList.contains('is-active');
    const percentage = Math.max(0, Math.min(100, Number(parseFlexibleNumber(editorField('ofertaPct')?.value) || 0)));
    const offerPrice = offerActive
      ? Math.round(articleEditorBasePrice * (1 - percentage / 100) * 100) / 100
      : articleEditorBasePrice;
    const money = (number) => `$ ${Number(number || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    value.textContent = money(offerPrice);
    value.classList.toggle('is-offer', offerActive);
    state.textContent = offerActive ? `OFERTA ${percentage.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %` : 'PRECIO DE LISTA';
    state.classList.toggle('is-offer', offerActive);
    previous.textContent = offerActive ? `Antes ${money(articleEditorBasePrice)}` : '';
    previous.hidden = !offerActive;
  }

  function editorImageUrl() {
    if (!articleEditorImages.length) return '';
    articleEditorImageIndex = Math.max(0, Math.min(articleEditorImageIndex, articleEditorImages.length - 1));
    return articleEditorImages[articleEditorImageIndex] || '';
  }

  function renderArticleEditorGallery() {
    if (!articleEditorHost) return;
    const image = articleEditorHost.querySelector('[data-editor-photo]');
    const count = articleEditorHost.querySelector('[data-editor-photo-count]');
    const url = editorImageUrl();
    if (image) {
      image.src = url;
      image.style.visibility = url ? 'visible' : 'hidden';
    }
    if (count) count.textContent = articleEditorImages.length ? `${articleEditorImageIndex + 1}/${articleEditorImages.length}` : '0/0';
    articleEditorHost.querySelectorAll('[data-editor-photo-prev],[data-editor-photo-next]').forEach((button) => {
      button.disabled = articleEditorImages.length <= 1;
    });
    const manager = articleEditorHost.querySelector('[data-editor-images-list]');
    if (manager) {
      manager.innerHTML = articleEditorImages.length
        ? articleEditorImages.map((item, index) => `
          <div class="corralon-editor-image-item${index === articleEditorImageIndex ? ' is-current' : ''}" data-editor-image-index="${index}" draggable="true">
            <img src="${String(item).replace(/"/g, '&quot;')}" alt="Imagen ${index + 1}">
            <div><b>${index === 0 ? 'Principal' : `Imagen ${index + 1}`}</b><small>${String(item).startsWith('blob:') ? 'Pendiente de guardar' : `${index + 1} de ${articleEditorImages.length}`}</small></div>
            <button type="button" data-editor-image-remove="${index}" aria-label="Eliminar imagen">×</button>
          </div>`).join('')
        : '<div class="corralon-editor-empty">Todavía no hay imágenes para este artículo.</div>';
    }
  }

  function addArticleEditorFiles(files) {
    Array.from(files || []).filter((file) => file?.type?.startsWith('image/')).forEach((file) => {
      const url = URL.createObjectURL(file);
      articleEditorImageFiles.set(url, file);
      articleEditorImages.push(url);
      articleEditorImageIndex = articleEditorImages.length - 1;
    });
    renderArticleEditorGallery();
  }

  function removeArticleEditorImage(index = articleEditorImageIndex) {
    const url = articleEditorImages[index];
    if (!url) return;
    if (String(url).startsWith('blob:')) URL.revokeObjectURL(url);
    articleEditorImageFiles.delete(url);
    articleEditorImages.splice(index, 1);
    articleEditorImageIndex = Math.max(0, Math.min(index, articleEditorImages.length - 1));
    renderArticleEditorGallery();
  }

  function moveArticleEditorImage(from, to) {
    if (from === to || from < 0 || to < 0 || from >= articleEditorImages.length || to >= articleEditorImages.length) return;
    const [item] = articleEditorImages.splice(from, 1);
    articleEditorImages.splice(to, 0, item);
    articleEditorImageIndex = to;
    renderArticleEditorGallery();
  }

  function articleEditorDateToDisplay(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
  }

  function articleEditorDateToIso(value) {
    const parsed = window.CorralonFunciones?.parseFechaFlexible?.(value);
    if (!parsed) return String(value || '').trim();
    return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
  }

  function formatArticleEditorNumber(input, decimals = 2, editing = false) {
    if (!input) return;
    const fn = window.CorralonFunciones;
    const kind = input.dataset.editorKind || 'number';
    const prefix = kind === 'money' ? '$ ' : '';
    const suffix = kind === 'percent' ? ' %' : '';
    const source = String(input.value || '').replace(/\$/g, '').replace(/%/g, '').trim();
    const expressionSource = source.replace(/\s+/g, '');
    if (editing && /[+\-*/()%]/.test(expressionSource.replace(/^-/, ''))) return;

    if (editing) {
      const negative = expressionSource.startsWith('-');
      const unsigned = expressionSource.replace(/-/g, '');
      const commaAt = unsigned.indexOf(',');
      const integerSource = commaAt >= 0 ? unsigned.slice(0, commaAt) : unsigned;
      const decimalSource = commaAt >= 0 ? unsigned.slice(commaAt + 1) : '';
      const integerDigits = (integerSource.replace(/\D/g, '') || '0').replace(/^0+(?=\d)/, '');
      const decimalDigits = decimalSource.replace(/\D/g, '').slice(0, decimals);
      const integerFormatted = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      input.value = `${prefix}${negative ? '-' : ''}${integerFormatted}${commaAt >= 0 && decimals ? `,${decimalDigits}` : ''}${suffix}`;
      const caret = input.value.length - suffix.length;
      input.setSelectionRange?.(caret, caret);
      return;
    }

    const number = fn?.evaluateNumericExpression ? fn.evaluateNumericExpression(source) : parseFlexibleNumber(source);
    if (!Number.isFinite(number)) return;
    input.value = `${prefix}${Number(number).toLocaleString('es-AR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })}${suffix}`;
  }

  function insertArticleEditorDecimal(input) {
    if (!input || input.readOnly || input.disabled) return;
    const suffix = input.dataset.editorKind === 'percent' ? ' %' : '';
    const value = String(input.value || '');
    const editableEnd = Math.max(0, value.length - suffix.length);
    const start = Math.min(Number(input.selectionStart ?? editableEnd), editableEnd);
    const end = Math.min(Number(input.selectionEnd ?? start), editableEnd);
    const before = value.slice(0, start);
    const after = value.slice(end, editableEnd);
    const cleanBefore = before.replace(/,/g, '');
    input.value = `${cleanBefore},${after}${suffix}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function bindArticleEditorFunctions() {
    if (articleEditorFunctionsBound || !articleEditorHost) return;
    articleEditorFunctionsBound = true;
    const fn = window.CorralonFunciones;
    fn?.bindLinearNavigation?.({
      root: articleEditorHost,
      selector: '.corralon-article-editor-card [data-editor-field],.corralon-article-editor-card [data-editor-chip],.corralon-article-editor-card [data-editor-images-open],.corralon-article-editor-card [data-editor-apply-open],.corralon-article-editor-card [data-editor-save],[data-editor-target-search],[data-editor-target-code],[data-editor-apply-field],[data-editor-apply-confirm]',
      selectOnFocus: true,
      navigateLeftRight: true,
      smartCaret: true,
      selectOnAnyFocus: true,
      selectOnFirstPointerFocus: true
    });
    fn?.bindShiftEnterNewLine?.({ root: articleEditorHost });
    fn?.bindLabelSelect?.({ root: articleEditorHost });

    articleEditorHost.addEventListener('input', (event) => {
      const field = event.target?.closest?.('[data-editor-number]');
      if (!field) return;
      formatArticleEditorNumber(field, Number(field.dataset.editorNumber || 2), true);
      if (field.dataset.editorField === 'ofertaPct') renderArticleEditorPrice();
    });
    articleEditorHost.addEventListener('focusout', (event) => {
      const number = event.target?.closest?.('[data-editor-number]');
      if (number) formatArticleEditorNumber(number, Number(number.dataset.editorNumber || 2), false);
      const date = event.target?.closest?.('[data-editor-date]');
      if (date && date.value.trim()) {
        const parsed = fn?.parseFechaFlexible?.(date.value);
        if (parsed) date.value = parsed.text;
      }
    });
    articleEditorHost.addEventListener('keydown', (event) => {
      const number = event.target?.closest?.('[data-editor-number]');
      if (number && event.code === 'NumpadDecimal') {
        event.preventDefault();
        event.stopImmediatePropagation();
        insertArticleEditorDecimal(number);
        return;
      }
      if (number && event.key === 'Enter') formatArticleEditorNumber(number, Number(number.dataset.editorNumber || 2), false);
      const date = event.target?.closest?.('[data-editor-date]');
      if (date && event.key === 'Enter' && date.value.trim()) {
        const parsed = fn?.parseFechaFlexible?.(date.value);
        if (parsed) date.value = parsed.text;
      }
    }, true);
  }

  function renderArticleEditorTargets() {
    if (!articleEditorHost) return;
    const query = String(articleEditorHost.querySelector('[data-editor-target-search]')?.value || '').trim().toLowerCase();
    const list = articleEditorAdapter.getArticles?.() || [];
    const targetList = articleEditorHost.querySelector('[data-editor-target-list]');
    const filtered = list.filter((item) => {
      const code = articleCode(item);
      if (!code || code === articleEditorOriginalCode) return false;
      const name = String(item.nombre ?? item.descripcion ?? '');
      return !query || `${code} ${name}`.toLowerCase().includes(query);
    }).slice(0, 250);
    targetList.innerHTML = filtered.length
      ? filtered.map((item) => {
        const code = articleCode(item);
        const name = String(item.nombre ?? item.descripcion ?? '');
        return `<label><input type="checkbox" data-editor-target-code="${code.replace(/"/g, '&quot;')}" ${articleEditorApplyTargets.has(code) ? 'checked' : ''}><b>${code}</b><span>${name}</span></label>`;
      }).join('')
      : '<div class="corralon-editor-empty">No hay artículos encontrados.</div>';
    articleEditorHost.querySelectorAll('[data-editor-apply-field]').forEach((button) => {
      button.classList.toggle('is-active', articleEditorApplyFields.has(button.dataset.editorApplyField));
    });
    updateArticleEditorTargetCount();
  }

  function updateArticleEditorTargetCount() {
    const mainButton = articleEditorHost?.querySelector('[data-editor-apply-open]');
    if (mainButton) mainButton.textContent = articleEditorApplyTargets.size
      ? `Aplicar también a (${articleEditorApplyTargets.size})`
      : 'Aplicar cambios también a';
  }

  function openArticleEditorTargets() {
    if (!articleEditorHost) return;
    articleEditorHost.querySelector('[data-editor-target-search]').value = '';
    renderArticleEditorTargets();
    articleEditorHost.querySelector('[data-editor-apply-dialog]').classList.add('is-open');
    setTimeout(() => articleEditorHost.querySelector('[data-editor-target-search]')?.focus(), 0);
  }

  function applyArticleEditorFields(target, source, fields) {
    const updated = { ...target };
    if (fields.has('etiquetas')) {
      ['oferta', 'ofertaPct', 'ofertaHasta', 'destacado', 'masVendido', 'accesoRapido', 'ceramico', 'ceramicoM2', 'ceramicoPlacas'].forEach((key) => {
        updated[key] = source[key];
      });
    }
    if (fields.has('detalle')) updated.detalle = source.detalle;
    if (fields.has('tags')) updated.tagsOcultos = [...articleTags(source.tagsOcultos)];
    if (fields.has('foto')) {
      updated.fotoUrl = source.fotoUrl || '';
      updated.imagenes = [...articleImages(source)];
    }
    updated.timestamp = Date.now();
    return updated;
  }

  function ensureArticleEditorHost() {
    if (articleEditorHost?.isConnected) return articleEditorHost;
    const style = document.createElement('style');
    style.textContent = `
      .corralon-article-editor-host{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.72)}
      .corralon-article-editor-host.is-open{display:flex}
      .corralon-article-editor-card{width:min(680px,100%);max-height:94dvh;overflow:auto;border:1px solid #ccc;border-radius:18px;background:#fff;padding:22px;box-shadow:0 22px 60px rgba(0,0,0,.34);font-family:Arial,sans-serif;color:#171717}
      .corralon-article-editor-head{display:flex;align-items:center;justify-content:space-between;margin:-22px -22px 16px;padding:18px 22px 14px;position:sticky;top:-22px;z-index:5;background:#fff;border-bottom:1px solid #ddd}
      .corralon-article-editor-title{font:900 22px/1 'Barlow Condensed',Arial,sans-serif;text-transform:uppercase}
      .corralon-article-editor-close{width:36px;height:36px;border:0;border-radius:50%;background:#eee;color:#222;font-size:23px;cursor:pointer}
      .corralon-article-editor-info{display:grid;grid-template-columns:minmax(90px,.65fr) minmax(0,2fr) minmax(140px,.8fr);gap:6px 18px;margin:0 0 18px;padding:14px;border:1px solid #ddd;border-radius:14px;background:#f5f5f3}
      .corralon-article-editor-info-label{font:800 11px/1 Arial,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:#666}
      .corralon-article-editor-info-value{min-width:0;font:800 14px/1.3 Arial,sans-serif;color:#171717;overflow-wrap:anywhere}
      .corralon-article-editor-info-price{grid-row:1/3;grid-column:3;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:5px;text-align:right}
      .corralon-article-editor-price-state{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;background:#e5e5e2;color:#555;font:900 10px/1 Arial,sans-serif;letter-spacing:.45px}
      .corralon-article-editor-price-state.is-offer{background:#ef111b;color:#fff}
      .corralon-article-editor-price{font:900 22px/1 'Barlow Condensed',Arial,sans-serif}
      .corralon-article-editor-price.is-offer{color:#d90009}
      .corralon-article-editor-price-before{font:700 11px/1 Arial,sans-serif;color:#777;text-decoration:line-through}
      .corralon-article-editor-info-rubro{grid-column:1/-1;display:flex;gap:7px;align-items:baseline;margin-top:6px;padding-top:10px;border-top:1px solid #ddd}
      .corralon-article-editor-info-rubro .corralon-article-editor-info-value{font-weight:700}
      .corralon-article-editor-main-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .corralon-article-editor-field{display:grid;gap:5px;margin-bottom:12px}
      .corralon-article-editor-field label{font:800 11px/1 Arial,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:#666}
      .corralon-article-editor-field input,.corralon-article-editor-field textarea{width:100%;box-sizing:border-box;border:1px solid #bbb;border-radius:11px;background:#fff;color:#171717;padding:11px 13px;font:14px/1.25 Arial,sans-serif;outline:none}
      .corralon-article-editor-field textarea{min-height:76px;resize:vertical}
      .corralon-article-editor-field input:focus,.corralon-article-editor-field textarea:focus{border-color:#777;box-shadow:0 0 0 2px rgba(0,0,0,.08)}
      .corralon-article-editor-chips{display:flex;flex-wrap:wrap;gap:8px;margin:5px 0 16px}
      .corralon-article-editor-chip{border:1px solid #ccc;border-radius:999px;background:#f6f6f4;color:#333;padding:8px 12px;font-weight:800;cursor:pointer}
      .corralon-article-editor-chip.is-active{border-color:#d90009;background:#ef111b;color:#fff}
      .corralon-article-editor-extras{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 14px;padding:14px 14px 2px;border:1px solid #ddd;border-radius:14px;background:#f7f7f5}
      .corralon-article-editor-section-title{grid-column:1/-1;font:900 13px/1 'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;color:#333}
      .corralon-article-editor-extras[hidden]{display:none!important}
      .corralon-article-editor-photo-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .corralon-article-editor-photo-head label{font:800 11px/1 Arial,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:#666}
      .corralon-article-editor-photo-head button{border:0;border-radius:999px;background:#ef111b;color:#fff;padding:9px 14px;font-weight:900;cursor:pointer}
      .corralon-article-editor-photo{position:relative;display:grid;place-items:center;min-height:180px;margin:5px 0 14px;border:2px dashed #ddd;border-radius:14px;background:#fafafa;overflow:hidden;cursor:pointer}
      .corralon-article-editor-photo img{width:100%;height:180px;object-fit:contain;background:#f6f6f6}
      .corralon-article-editor-photo input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
      .corralon-editor-photo-tools{position:absolute;right:10px;top:10px;display:flex;align-items:center;gap:6px;z-index:2}
      .corralon-editor-photo-tools button,.corralon-editor-photo-tools span{display:grid;place-items:center;min-width:28px;height:28px;border:0;border-radius:50%;background:#777;color:#fff;font-weight:900}
      .corralon-editor-photo-tools button{cursor:pointer}.corralon-editor-photo-tools button:disabled{opacity:.45}
      .corralon-article-editor-actions{display:grid;grid-template-columns:.8fr 1.2fr 1.2fr;gap:10px;position:sticky;bottom:-22px;z-index:5;background:#fff;margin:0 -22px -22px;padding:14px 22px 18px;border-top:1px solid #ddd}
      .corralon-article-editor-actions button{min-height:46px;border:1px solid #bbb;border-radius:12px;background:#fff;font-weight:900;cursor:pointer}
      .corralon-article-editor-actions button[data-editor-apply-open]{border-color:#aaa;background:#f3f3f1;color:#222}
      .corralon-article-editor-actions button[data-editor-save]{border-color:#ef111b;background:#ef111b;color:#fff}
      .corralon-article-editor-actions button:disabled{opacity:.55;cursor:wait}
      .corralon-editor-subdialog{position:fixed;inset:0;z-index:2147483010;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(0,0,0,.65)}
      .corralon-editor-subdialog.is-open{display:flex}
      .corralon-editor-subcard{width:min(680px,100%);max-height:88dvh;overflow:auto;border-radius:16px;background:#fff;padding:18px;box-shadow:0 18px 55px rgba(0,0,0,.38)}
      .corralon-editor-subhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.corralon-editor-subhead b{font-size:19px;text-transform:uppercase}
      .corralon-editor-subhead button{width:34px;height:34px;border:0;border-radius:50%;font-size:20px;cursor:pointer}
      .corralon-editor-image-list,.corralon-editor-target-list{display:grid;gap:7px;max-height:55dvh;overflow:auto}
      .corralon-editor-image-item{display:grid;grid-template-columns:64px 1fr 36px;align-items:center;gap:10px;border:1px solid #ddd;border-radius:11px;padding:7px;background:#fff}
      .corralon-editor-image-item.is-current{border-color:#777;background:#eee}.corralon-editor-image-item img{width:64px;height:54px;object-fit:contain}.corralon-editor-image-item small{display:block;color:#777;margin-top:3px}.corralon-editor-image-item button{border:0;background:#ef111b;color:#fff;border-radius:8px;height:34px;font-weight:900;cursor:pointer}
      .corralon-editor-upload{display:block;margin-top:10px;border:2px dashed #ccc;border-radius:12px;padding:16px;text-align:center;cursor:pointer}.corralon-editor-upload input{display:none}
      .corralon-editor-target-search{width:100%;box-sizing:border-box;border:1px solid #bbb;border-radius:11px;padding:11px 13px;margin-bottom:10px}
      .corralon-editor-target-list label{display:grid;grid-template-columns:24px 110px 1fr;align-items:center;gap:8px;border:1px solid #ddd;border-radius:9px;padding:8px;cursor:pointer}
      .corralon-editor-target-list label:hover{background:#eee}.corralon-editor-target-fields{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.corralon-editor-target-fields button{border:1px solid #bbb;border-radius:999px;background:#fff;padding:8px 12px;font-weight:800;cursor:pointer}.corralon-editor-target-fields button.is-active{background:#ef111b;border-color:#ef111b;color:#fff}
      .corralon-editor-subactions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.corralon-editor-subactions button{min-height:42px;border:1px solid #bbb;border-radius:10px;background:#fff;padding:0 18px;font-weight:900;cursor:pointer}.corralon-editor-subactions button:last-child{background:#ef111b;border-color:#ef111b;color:#fff}
      .corralon-editor-empty{padding:22px;text-align:center;color:#777}
      @media(max-width:560px){.corralon-article-editor-host{padding:0}.corralon-article-editor-card{width:100%;max-height:100dvh;border-radius:0;padding:18px}.corralon-article-editor-head{margin:-18px -18px 14px;top:-18px;padding:16px 18px 13px}.corralon-article-editor-info{grid-template-columns:90px 1fr}.corralon-article-editor-info-price{grid-row:auto;grid-column:1/-1;align-items:flex-start;text-align:left;padding-top:10px;border-top:1px solid #ddd}.corralon-article-editor-main-grid,.corralon-article-editor-extras{grid-template-columns:1fr}.corralon-article-editor-actions{margin:0 -18px -18px;padding:12px 18px 16px;grid-template-columns:1fr}.corralon-article-editor-actions button{min-height:42px}}
    `;
    document.head.appendChild(style);
    articleEditorHost = document.createElement('div');
    articleEditorHost.className = 'corralon-article-editor-host';
    articleEditorHost.setAttribute('aria-hidden', 'true');
    articleEditorHost.innerHTML = `
      <div class="corralon-article-editor-card" role="dialog" aria-modal="true" aria-label="Editar artículo">
        <div class="corralon-article-editor-head"><div class="corralon-article-editor-title">Editar artículo</div><button class="corralon-article-editor-close" type="button" data-editor-close>×</button></div>
        <div class="corralon-article-editor-info">
          <div class="corralon-article-editor-info-label">Código</div><div class="corralon-article-editor-info-label">Descripción</div>
          <div class="corralon-article-editor-info-value" data-editor-info="codigo"></div><div class="corralon-article-editor-info-value" data-editor-info="nombre"></div>
          <div class="corralon-article-editor-info-price">
            <span class="corralon-article-editor-price-state" data-editor-info="precioEstado">Precio de lista</span>
            <strong class="corralon-article-editor-price" data-editor-info="precio"></strong>
            <small class="corralon-article-editor-price-before" data-editor-info="precioAnterior" hidden></small>
          </div>
          <div class="corralon-article-editor-info-rubro"><span class="corralon-article-editor-info-label">Rubro:</span><span class="corralon-article-editor-info-value" data-editor-info="rubro"></span></div>
        </div>
        <div class="corralon-article-editor-main-grid">
          <div class="corralon-article-editor-field"><label for="corralonEditDetalle">Detalle</label><textarea id="corralonEditDetalle" data-editor-field="detalle"></textarea></div>
          <div class="corralon-article-editor-field"><label for="corralonEditTags">Tags invisibles</label><textarea id="corralonEditTags" data-editor-field="tags" placeholder="Ej: portland, obra gruesa, pegamento"></textarea></div>
        </div>
        <div class="corralon-article-editor-field"><label>Etiquetas</label></div>
        <div class="corralon-article-editor-chips">
          <button type="button" class="corralon-article-editor-chip" data-editor-chip="oferta">En oferta</button>
          <button type="button" class="corralon-article-editor-chip" data-editor-chip="destacado">Destacado</button>
          <button type="button" class="corralon-article-editor-chip" data-editor-chip="masVendido">Más vendido</button>
          <button type="button" class="corralon-article-editor-chip" data-editor-chip="accesoRapido">Acceso rápido</button>
          <button type="button" class="corralon-article-editor-chip" data-editor-chip="ceramico">Cerámico</button>
        </div>
        <div class="corralon-article-editor-extras" data-editor-extra="oferta" hidden>
          <div class="corralon-article-editor-section-title">Configuración de oferta</div>
          <div class="corralon-article-editor-field"><label for="corralonEditOfertaPct">Descuento oferta %</label><input id="corralonEditOfertaPct" data-editor-field="ofertaPct" data-editor-number="2" data-editor-kind="percent" inputmode="decimal"></div>
          <div class="corralon-article-editor-field"><label for="corralonEditOfertaHasta">Oferta hasta</label><input id="corralonEditOfertaHasta" type="text" data-editor-field="ofertaHasta" data-editor-date placeholder="dd/mm/aaaa"></div>
        </div>
        <div class="corralon-article-editor-extras" data-editor-extra="ceramico" hidden>
          <div class="corralon-article-editor-section-title">Configuración de cerámico</div>
          <div class="corralon-article-editor-field"><label for="corralonEditCeramicoM2">M² por caja</label><input id="corralonEditCeramicoM2" data-editor-field="ceramicoM2" data-editor-number="2" inputmode="decimal"></div>
          <div class="corralon-article-editor-field"><label for="corralonEditCeramicoPlacas">Placas por caja</label><input id="corralonEditCeramicoPlacas" data-editor-field="ceramicoPlacas" data-editor-number="0" inputmode="numeric"></div>
        </div>
        <div class="corralon-article-editor-photo-head"><label>Foto (arrastrá o hacé clic para cambiar)</label><button type="button" data-editor-images-open>Ver imágenes</button></div>
        <div class="corralon-article-editor-photo" data-editor-photo-zone><img data-editor-photo alt="Foto del artículo"><input type="file" accept="image/*" multiple data-editor-photo-input>
          <div class="corralon-editor-photo-tools"><button type="button" data-editor-photo-prev>‹</button><span data-editor-photo-count>0/0</span><button type="button" data-editor-photo-next>›</button><button type="button" data-editor-photo-remove>×</button></div>
        </div>
        <div class="corralon-article-editor-actions"><button type="button" data-editor-close>Cancelar</button><button type="button" data-editor-apply-open>Aplicar cambios también a</button><button type="button" data-editor-save>Guardar cambios</button></div>
      </div>
      <div class="corralon-editor-subdialog" data-editor-images-dialog><div class="corralon-editor-subcard">
        <div class="corralon-editor-subhead"><b>Imágenes</b><button type="button" data-editor-images-close>×</button></div>
        <div class="corralon-editor-image-list" data-editor-images-list></div>
        <label class="corralon-editor-upload">Arrastrá, pegá o seleccioná imágenes<input type="file" accept="image/*" multiple data-editor-images-input></label>
      </div></div>
      <div class="corralon-editor-subdialog" data-editor-apply-dialog><div class="corralon-editor-subcard">
        <div class="corralon-editor-subhead"><b>Aplicar cambios también a</b><button type="button" data-editor-apply-close>×</button></div>
        <input class="corralon-editor-target-search" type="text" data-editor-target-search placeholder="Buscar artículo por código o nombre">
        <div class="corralon-editor-target-fields"><button type="button" data-editor-apply-field="etiquetas">Etiquetas</button><button type="button" data-editor-apply-field="detalle">Detalle</button><button type="button" data-editor-apply-field="tags">Tags</button><button type="button" data-editor-apply-field="foto">Fotos</button></div>
        <div class="corralon-editor-target-list" data-editor-target-list></div>
        <div class="corralon-editor-subactions"><button type="button" data-editor-apply-close>Cancelar</button><button type="button" data-editor-apply-confirm>Confirmar selección</button></div>
      </div></div>`;
    document.body.appendChild(articleEditorHost);
    articleEditorHost.addEventListener('click', (event) => {
      if (event.target === articleEditorHost) closeArticleEditor();
      if (event.target.matches?.('[data-editor-images-dialog]')) {
        event.target.classList.remove('is-open');
        articleEditorHost.querySelector('[data-editor-images-open]')?.focus();
      }
      if (event.target.matches?.('[data-editor-apply-dialog]')) {
        event.target.classList.remove('is-open');
        articleEditorHost.querySelector('[data-editor-apply-open]')?.focus();
      }
      if (event.target.closest('[data-editor-close]')) closeArticleEditor();
      const chip = event.target.closest('[data-editor-chip]');
      if (chip) {
        chip.classList.toggle('is-active');
        syncArticleEditorSections();
      }
      if (event.target.closest('[data-editor-save]')) saveArticleEditor();
      if (event.target.closest('[data-editor-images-open]')) {
        renderArticleEditorGallery();
        articleEditorHost.querySelector('[data-editor-images-dialog]').classList.add('is-open');
      }
      if (event.target.closest('[data-editor-images-close]')) {
        articleEditorHost.querySelector('[data-editor-images-dialog]').classList.remove('is-open');
        articleEditorHost.querySelector('[data-editor-images-open]')?.focus();
      }
      if (event.target.closest('[data-editor-photo-prev]')) {
        articleEditorImageIndex = (articleEditorImageIndex - 1 + articleEditorImages.length) % Math.max(1, articleEditorImages.length);
        renderArticleEditorGallery();
      }
      if (event.target.closest('[data-editor-photo-next]')) {
        articleEditorImageIndex = (articleEditorImageIndex + 1) % Math.max(1, articleEditorImages.length);
        renderArticleEditorGallery();
      }
      if (event.target.closest('[data-editor-photo-remove]')) removeArticleEditorImage();
      const removeImage = event.target.closest('[data-editor-image-remove]');
      if (removeImage) removeArticleEditorImage(Number(removeImage.dataset.editorImageRemove));
      const imageItem = event.target.closest('[data-editor-image-index]');
      if (imageItem && !removeImage) {
        articleEditorImageIndex = Number(imageItem.dataset.editorImageIndex);
        renderArticleEditorGallery();
      }
      if (event.target.closest('[data-editor-apply-open]')) openArticleEditorTargets();
      if (event.target.closest('[data-editor-apply-close]')) {
        articleEditorHost.querySelector('[data-editor-apply-dialog]').classList.remove('is-open');
        articleEditorHost.querySelector('[data-editor-apply-open]')?.focus();
      }
      const applyField = event.target.closest('[data-editor-apply-field]');
      if (applyField) {
        const key = applyField.dataset.editorApplyField;
        if (articleEditorApplyFields.has(key)) articleEditorApplyFields.delete(key);
        else articleEditorApplyFields.add(key);
        renderArticleEditorTargets();
      }
      if (event.target.closest('[data-editor-apply-confirm]')) {
        articleEditorHost.querySelector('[data-editor-apply-dialog]').classList.remove('is-open');
        articleEditorHost.querySelector('[data-editor-apply-open]')?.focus();
      }
    });
    articleEditorHost.querySelector('[data-editor-photo-input]').addEventListener('change', (event) => {
      addArticleEditorFiles(event.target.files);
      event.target.value = '';
    });
    articleEditorHost.querySelector('[data-editor-images-input]').addEventListener('change', (event) => {
      addArticleEditorFiles(event.target.files);
      event.target.value = '';
    });
    const photoZone = articleEditorHost.querySelector('[data-editor-photo-zone]');
    photoZone.addEventListener('dragover', (event) => event.preventDefault());
    photoZone.addEventListener('drop', (event) => { event.preventDefault(); addArticleEditorFiles(event.dataTransfer.files); });
    const uploadZone = articleEditorHost.querySelector('.corralon-editor-upload');
    uploadZone.addEventListener('dragover', (event) => event.preventDefault());
    uploadZone.addEventListener('drop', (event) => { event.preventDefault(); addArticleEditorFiles(event.dataTransfer.files); });
    articleEditorHost.querySelector('[data-editor-images-list]').addEventListener('dragstart', (event) => {
      const item = event.target.closest('[data-editor-image-index]');
      if (item) event.dataTransfer.setData('text/plain', item.dataset.editorImageIndex);
    });
    articleEditorHost.querySelector('[data-editor-images-list]').addEventListener('dragover', (event) => event.preventDefault());
    articleEditorHost.querySelector('[data-editor-images-list]').addEventListener('drop', (event) => {
      event.preventDefault();
      const item = event.target.closest('[data-editor-image-index]');
      if (item) moveArticleEditorImage(Number(event.dataTransfer.getData('text/plain')), Number(item.dataset.editorImageIndex));
    });
    articleEditorHost.querySelector('[data-editor-target-search]').addEventListener('input', renderArticleEditorTargets);
    articleEditorHost.querySelector('[data-editor-target-list]').addEventListener('change', (event) => {
      const input = event.target.closest('[data-editor-target-code]');
      if (!input) return;
      if (input.checked) articleEditorApplyTargets.add(input.dataset.editorTargetCode);
      else articleEditorApplyTargets.delete(input.dataset.editorTargetCode);
      updateArticleEditorTargetCount();
    });
    bindArticleEditorFunctions();
    return articleEditorHost;
  }

  function configureArticleEditor(options = {}) {
    articleEditorAdapter = { ...articleEditorAdapter, ...options };
  }

  function openArticleEditor(code, options = {}) {
    const articleCodeValue = String(code || '').trim();
    const list = options.articles || articleEditorAdapter.getArticles?.() || [];
    const article = list.find((item) => articleCode(item) === articleCodeValue);
    if (!article) return false;
    const host = ensureArticleEditorHost();
    articleEditorOriginalCode = articleCodeValue;
    articleEditorImages.forEach((url) => { if (String(url).startsWith('blob:')) URL.revokeObjectURL(url); });
    articleEditorImages = articleImages(article);
    articleEditorImageIndex = 0;
    articleEditorImageFiles = new Map();
    articleEditorApplyTargets = new Set();
    articleEditorApplyFields = new Set(['etiquetas']);
    articleEditorReturnFocus = options.returnFocus || document.activeElement;
    editorInfo('codigo').textContent = articleCodeValue;
    editorInfo('nombre').textContent = String(article.nombre ?? article.descripcion ?? '');
    editorInfo('rubro').textContent = String(article.rubro ?? '') || 'Sin rubro';
    articleEditorBasePrice = Number(article.precio || 0);
    editorField('detalle').value = String(article.detalle ?? '');
    editorField('tags').value = articleTags(article.tagsOcultos ?? article.tagsBusqueda ?? article.tags ?? '').join(', ');
    editorField('ofertaPct').value = Number(article.ofertaPct ?? article.oferta_pct ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    editorField('ofertaHasta').value = articleEditorDateToDisplay(article.ofertaHasta ?? article.oferta_hasta ?? '');
    editorField('ceramicoM2').value = Number(article.ceramicoM2 ?? article.m2 ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    editorField('ceramicoPlacas').value = Number(article.ceramicoPlacas ?? article.placas ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
    host.querySelectorAll('[data-editor-number]').forEach((field) => {
      formatArticleEditorNumber(field, Number(field.dataset.editorNumber || 2), false);
    });
    renderArticleEditorPrice();
    host.querySelectorAll('[data-editor-chip]').forEach((chip) => {
      const key = chip.dataset.editorChip;
      const aliases = {
        oferta: article.oferta ?? article.enOferta,
        destacado: article.destacado,
        masVendido: article.masVendido ?? article.mas_vendido,
        accesoRapido: article.accesoRapido ?? article.rapido,
        ceramico: article.ceramico
      };
      chip.classList.toggle('is-active', articleBool(aliases[key]));
    });
    host.querySelector('[data-editor-photo-input]').value = '';
    host.querySelector('[data-editor-images-input]').value = '';
    host.querySelectorAll('.corralon-editor-subdialog').forEach((dialog) => dialog.classList.remove('is-open'));
    syncArticleEditorSections();
    renderArticleEditorGallery();
    host.classList.add('is-open');
    host.setAttribute('aria-hidden', 'false');
    setTimeout(() => editorField('detalle')?.focus(), 0);
    return true;
  }

  function closeArticleEditor() {
    if (!articleEditorHost) return;
    articleEditorHost.classList.remove('is-open');
    articleEditorHost.setAttribute('aria-hidden', 'true');
    articleEditorImages.forEach((url) => { if (String(url).startsWith('blob:')) URL.revokeObjectURL(url); });
    articleEditorImages = [];
    articleEditorImageFiles = new Map();
    articleEditorApplyTargets = new Set();
    articleEditorHost.querySelectorAll('.corralon-editor-subdialog').forEach((dialog) => dialog.classList.remove('is-open'));
    articleEditorReturnFocus?.focus?.();
    articleEditorReturnFocus = null;
  }

  async function uploadArticleImage(file, code) {
    const data = new FormData();
    data.append('file', file);
    data.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    data.append('public_id', `articulos/${code}_${Date.now()}`);
    const response = await fetch('https://api.cloudinary.com/v1_1/do0i2da7h/image/upload', { method: 'POST', body: data });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo subir la imagen');
    return payload.secure_url;
  }

  async function saveArticleEditor() {
    const list = articleEditorAdapter.getArticles?.() || [];
    const original = list.find((item) => articleCode(item) === articleEditorOriginalCode);
    if (!original) return;
    const code = articleEditorOriginalCode;
    const name = String(original.nombre ?? original.descripcion ?? '').trim();
    const price = articleEditorBasePrice;
    if (!code || !name || price === null) {
      alert('Completá código, nombre y precio');
      return;
    }
    if (list.some((item) => articleCode(item) === code && articleCode(item) !== articleEditorOriginalCode)) {
      alert('Ya existe otro artículo con ese código');
      return;
    }
    const saveButton = articleEditorHost.querySelector('[data-editor-save]');
    saveButton.disabled = true;
    saveButton.textContent = 'Guardando...';
    try {
      const images = [...articleEditorImages];
      for (let index = 0; index < images.length; index += 1) {
        const file = articleEditorImageFiles.get(images[index]);
        if (!file) continue;
        const blobUrl = images[index];
        images[index] = await uploadArticleImage(file, code);
        URL.revokeObjectURL(blobUrl);
        articleEditorImageFiles.delete(blobUrl);
      }
      const savedImages = [...new Set(images.filter((item) => item && !String(item).startsWith('blob:')))];
      const active = (key) => articleEditorHost.querySelector(`[data-editor-chip="${key}"]`)?.classList.contains('is-active');
      const updated = {
        ...original,
        codigo: code,
        idart: code,
        nombre: name,
        descripcion: name,
        detalle: String(editorField('detalle').value || '').trim(),
        rubro: String(original.rubro || '').trim(),
        tagsOcultos: articleTags(editorField('tags').value),
        precio: price,
        fotoUrl: savedImages[0] || '',
        imagenes: savedImages,
        oferta: active('oferta'),
        ofertaPct: active('oferta') ? Number(parseFlexibleNumber(editorField('ofertaPct').value) || 0) : 0,
        ofertaHasta: active('oferta') ? articleEditorDateToIso(editorField('ofertaHasta').value) : '',
        destacado: active('destacado'),
        masVendido: active('masVendido'),
        accesoRapido: active('accesoRapido'),
        ceramico: active('ceramico'),
        ceramicoM2: active('ceramico') ? Number(parseFlexibleNumber(editorField('ceramicoM2').value) || 0) : 0,
        ceramicoPlacas: active('ceramico') ? Math.max(0, Math.round(Number(parseFlexibleNumber(editorField('ceramicoPlacas').value) || 0))) : 0,
        timestamp: Date.now()
      };
      const nextList = list.map((item) => {
        const itemCode = articleCode(item);
        if (itemCode === articleEditorOriginalCode) return updated;
        if (!articleEditorApplyTargets.has(itemCode)) return item;
        return applyArticleEditorFields(item, updated, articleEditorApplyFields);
      });
      if (!articleEditorAdapter.save) throw new Error('El editor no está conectado a esta página');
      await articleEditorAdapter.save(nextList, updated, articleEditorOriginalCode);
      window.dispatchEvent(new CustomEvent('corralon:article-updated', { detail: { article: updated, previousCode: articleEditorOriginalCode } }));
      closeArticleEditor();
    } catch (error) {
      console.error(error);
      alert(error.message || 'No se pudo guardar el artículo');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Guardar cambios';
    }
  }

  function serializeArticleBase(article = {}) {
    const code = articleCode(article);
    const stocks = resolveBranchStocks(article);
    const providerCode = String(article.idartprov ?? article.codprov ?? '').trim();
    const providerId = String(article.idProveedor ?? article.id_proveedor ?? '').trim();
    const name = String(article.nombre ?? article.descripcion ?? '').trim();
    return {
      codigo: code, idart: code, idartprov: providerCode, codprov: providerCode,
      idProveedor: providerId, id_proveedor: providerId, nombre: name, descripcion: name,
      rubro: String(article.rubro || ''),
      precio: Number(article.precio ?? article.PrecioVta3 ?? 0),
      precioCosto: Number(article.precioCosto ?? article.precio_costo ?? article.PrecioCpraSISDto ?? 0),
      precio_costo: Number(article.precioCosto ?? article.precio_costo ?? article.PrecioCpraSISDto ?? 0),
      PrecioCpraSISDto: Number(article.PrecioCpraSISDto ?? article.precioCosto ?? article.precio_costo ?? 0),
      PrecioCpraCI: Number(article.PrecioCpraCI ?? article.precioCpraCI ?? 0),
      PrecioVta3: Number(article.PrecioVta3 ?? article.precio ?? 0),
      PorcGanMin: Number(article.PorcGanMin ?? article.porcGanMin ?? 0),
      stock: stocks.stock ?? article.stock ?? '',
      stockSucursalProgresoRuta: stocks.stockSucursalProgresoRuta ?? '',
      stockSucursalCalle5Espana: stocks.stockSucursalCalle5Espana ?? '',
      sourceRows: Array.isArray(article.sourceRows ?? article.source_rows) ? (article.sourceRows ?? article.source_rows) : []
    };
  }

  function serializeArticleMeta(article = {}) {
    const images = articleImages(article);
    return {
      codigo: articleCode(article),
      detalle: String(article.detalle || ''),
      tagsOcultos: articleTags(article.tagsOcultos ?? article.tagsBusqueda ?? ''),
      fotoUrl: images[0] || '',
      imagenes: images,
      oferta: articleBool(article.oferta),
      ofertaPct: Number(article.ofertaPct || 0),
      ofertaHasta: String(article.ofertaHasta || ''),
      destacado: articleBool(article.destacado),
      masVendido: articleBool(article.masVendido ?? article.mas_vendido),
      accesoRapido: articleBool(article.accesoRapido ?? article.rapido),
      ceramico: articleBool(article.ceramico),
      ceramicoM2: Number(article.ceramicoM2 || 0),
      ceramicoPlacas: Number(article.ceramicoPlacas || 0)
    };
  }

  async function uploadArticleJson(rows, prefix) {
    const form = new FormData();
    form.append('file', new Blob([JSON.stringify(rows)], { type: 'application/json' }));
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    form.append('public_id', `${prefix}_${Date.now()}`);
    form.append('resource_type', 'raw');
    const response = await fetch(CLOUDINARY_RAW_UPLOAD_URL, { method: 'POST', body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || 'No se pudo publicar el catálogo');
    return payload.secure_url;
  }

  async function publishArticleCatalog(list = []) {
    const merged = mergeArticleBranchStocks(list || []);
    const metaUrl = await uploadArticleJson(merged.map(serializeArticleMeta), 'articulos_meta');
    let baseUrl = await CATALOG.getConfigUrl('listaActual').catch(() => '');
    if (!baseUrl) baseUrl = await uploadArticleJson(merged.map(serializeArticleBase), 'articulos_respaldo');
    return { baseUrl, metaUrl };
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && articleEditorHost?.classList.contains('is-open')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const subdialog = articleEditorHost.querySelector('.corralon-editor-subdialog.is-open');
      if (subdialog) {
        subdialog.classList.remove('is-open');
        articleEditorHost.querySelector(subdialog.matches('[data-editor-images-dialog]') ? '[data-editor-images-open]' : '[data-editor-apply-open]')?.focus();
        return;
      }
      closeArticleEditor();
    }
  }, true);

  document.addEventListener('paste', (event) => {
    if (!articleEditorHost?.classList.contains('is-open')) return;
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.type?.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    addArticleEditorFiles(files);
  });

  function headers(extra = {}) {
    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...extra
    };
  }

  function norm(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function parseMoney(value) {
    let text = String(value ?? '').replace(/\$/g, '').replace(/\s/g, '');
    if (!text) return 0;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    return Number(text.replace(/[^0-9.-]/g, '')) || 0;
  }

  function parseFlexibleNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    let text = String(value).trim().replace(/[^0-9,.-]/g, '');
    if (!text) return null;
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      if (lastComma > lastDot) text = text.replace(/\./g, '').replace(/,/g, '.');
      else text = text.replace(/,/g, '');
    } else if (lastComma > -1) {
      text = text.replace(/\./g, '').replace(/,/g, '.');
    } else if ((text.match(/\./g) || []).length > 1) {
      text = text.replace(/\./g, '');
    }
    const number = Number(text);
    return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
  }

  function cleanId(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    return text ? text.replace(/\.0+$/, '') : '';
  }

  function idVariants(value) {
    const id = cleanId(value);
    if (!id) return [];
    const noZeros = id.replace(/^0+/, '') || '0';
    return [...new Set([id, noZeros])];
  }

  function dateOnly(value) {
    if (!value) return null;
    const date = new Date(value);
    const out = Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
    return out || null;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function nowTimestamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function percent(value) {
    return `${(Number(value || 0) * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function money(value) {
    return `$ ${Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function normalizeBranch(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const branch = BRANCHES.find((item) => item.id === raw || item.label === raw);
    return branch ? branch.label : raw;
  }

  function branchIdFromIdsuc(value) {
    const id = cleanId(value);
    if (id === '1') return 'progreso_ruta';
    if (id === '2') return 'calle5_espana';
    return '';
  }

  function readFirstNumber(source = {}, keys = []) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source || {}, key)) continue;
      const parsed = parseFlexibleNumber(source[key]);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  function resolveBranchStocks(source = {}, old = {}) {
    let progreso = readFirstNumber(source, BRANCH_STOCK_FIELDS.progreso_ruta);
    let calle5 = readFirstNumber(source, BRANCH_STOCK_FIELDS.calle5_espana);
    const idsucBranch = branchIdFromIdsuc(source.idsuc ?? source.id_suc ?? source.idsucursal ?? source.id_sucursal ?? source.sucursal_id);
    const sourceStock = parseFlexibleNumber(source.stock ?? source.existencia ?? source.cantidad);

    if (idsucBranch === 'progreso_ruta' && sourceStock !== null) progreso = sourceStock;
    if (idsucBranch === 'calle5_espana' && sourceStock !== null) calle5 = sourceStock;

    if (progreso === null) progreso = readFirstNumber(old, BRANCH_STOCK_FIELDS.progreso_ruta);
    if (calle5 === null) calle5 = readFirstNumber(old, BRANCH_STOCK_FIELDS.calle5_espana);

    const fallback = sourceStock ?? parseFlexibleNumber(old.stock ?? old.existencia ?? old.cantidad);
    const hasBranch = progreso !== null || calle5 !== null;
    return {
      stockSucursalProgresoRuta: progreso === null ? '' : progreso,
      stockSucursalCalle5Espana: calle5 === null ? '' : calle5,
      stock: hasBranch ? Number(((progreso || 0) + (calle5 || 0)).toFixed(2)) : (fallback === null ? '' : fallback)
    };
  }

  function firstFilled(...values) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && !value.trim()) continue;
      return value;
    }
    return '';
  }

  function mergeArticleBranchStocks(rows = []) {
    const byCode = new Map();
    (rows || []).forEach((row) => {
      const codigo = cleanId(row?.codigo ?? row?.idart ?? row?.idArt ?? row?.id ?? '');
      if (!codigo) return;
      const current = byCode.get(codigo) || { ...row, codigo };
      Object.keys(row || {}).forEach((key) => {
        current[key] = firstFilled(current[key], row[key]);
      });
      const stockInfo = resolveBranchStocks(row, current);
      current.stockSucursalProgresoRuta = stockInfo.stockSucursalProgresoRuta;
      current.stockSucursalCalle5Espana = stockInfo.stockSucursalCalle5Espana;
      current.stock = stockInfo.stock;
      current.idsuc = '';
      byCode.set(codigo, current);
    });
    return [...byCode.values()].map((row) => ({ ...row, ...resolveBranchStocks(row) }));
  }

  function imageGeneratorText(value) {
    return String(value ?? '').trim();
  }

  function imageGeneratorNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function imageGeneratorNormalizeArticle(article = {}) {
    const codigo = imageGeneratorText(article.codigo ?? article.idart ?? article.idArt ?? article.id ?? article.codigoArticulo);
    const nombre = imageGeneratorText(article.nombre ?? article.descripcion ?? article.articulo ?? article.detalleArticulo ?? article.producto);
    return {
      codigo,
      nombre,
      detalle: imageGeneratorText(article.detalle ?? article.descripcionSecundaria ?? article.descripcion_larga),
      rubro: imageGeneratorText(article.rubro ?? article.categoria ?? article.familia),
      precio: imageGeneratorNumber(article.precioVigente ?? article.precioFinal ?? article.precio ?? article.precio_costo),
      stock: imageGeneratorNumber(article.stock ?? article.existencia ?? article.cantidad),
      fotoUrl: imageGeneratorText(article.fotoUrl ?? article.foto ?? article.imagen ?? article.imageUrl ?? article.urlImagen),
      oferta: Boolean(article.oferta ?? article.ofertaVigente ?? article.enOferta ?? article.tagOferta),
      ofertaPct: imageGeneratorNumber(article.ofertaPct ?? article.oferta_pct ?? article.ofertaPorcentaje ?? article.descuentoOferta),
      destacado: Boolean(article.destacado ?? article.tagDestacado),
      masVendido: Boolean(article.masVendido ?? article.mas_vendido ?? article.tagMasVendido),
      ceramico: Boolean(article.ceramico ?? article.tagCeramico),
      ceramicoM2: imageGeneratorNumber(article.ceramicoM2 ?? article.m2Ceramico ?? article.m2 ?? article.metros2Ceramico),
      tagsOcultos: Array.isArray(article.tagsOcultos)
        ? article.tagsOcultos.map(imageGeneratorText).filter(Boolean)
        : imageGeneratorText(article.tagsOcultos ?? article.tagsBusqueda ?? article.tags ?? article.palabrasClave)
    };
  }

  function imageGeneratorSplitTitle(nombre = '') {
    const words = imageGeneratorText(nombre).split(/\s+/).filter(Boolean);
    if (words.length <= 2) return { title1: words.join(' ').toUpperCase(), title2: '' };
    const breakAt = Math.min(3, Math.max(1, Math.ceil(words.length / 2)));
    return {
      title1: words.slice(0, breakAt).join(' ').toUpperCase(),
      title2: words.slice(breakAt).join(' ').toUpperCase()
    };
  }

  function imageGeneratorOfferPrice(article) {
    if (!article.oferta || article.ofertaPct <= 0) return article.precio;
    return Math.max(0, article.precio * (1 - article.ofertaPct / 100));
  }

  function imageGeneratorRow(icon, label, value, detail = '') {
    const cleanLabel = imageGeneratorText(label).toUpperCase();
    const cleanValue = imageGeneratorText(value).toUpperCase();
    const cleanDetail = imageGeneratorText(detail).toUpperCase();
    return cleanLabel || cleanValue || cleanDetail ? { icon, label: cleanLabel, value: cleanValue, detail: cleanDetail } : null;
  }

  function buildImageGeneratorPayload(article = {}) {
    const normalized = imageGeneratorNormalizeArticle(article);
    const title = imageGeneratorSplitTitle(normalized.nombre);
    const precioFinal = imageGeneratorOfferPrice(normalized);
    const precioRow = normalized.precio > 0
      ? imageGeneratorRow('check', normalized.oferta ? 'PRECIO OFERTA' : 'PRECIO', money(precioFinal), normalized.oferta && normalized.ofertaPct > 0 ? `${normalized.ofertaPct}% DTO` : '')
      : null;
    const stockRow = imageGeneratorRow('check', 'STOCK', normalized.stock ? `${normalized.stock}` : '', normalized.stock ? 'DISPONIBLES' : '');
    const rubroRow = imageGeneratorRow('gear', 'RUBRO', normalized.rubro, '');
    const specs = [
      imageGeneratorRow('check', 'CODIGO', normalized.codigo, ''),
      precioRow,
      normalized.oferta && normalized.precio > 0 ? imageGeneratorRow('check', 'PRECIO LISTA', money(normalized.precio), '') : null,
      stockRow,
      rubroRow,
      normalized.ceramicoM2 > 0 ? imageGeneratorRow('check', 'M2 POR CAJA', `${normalized.ceramicoM2}`, '') : null
    ].filter(Boolean).slice(0, 6);
    const highlights = [precioRow, stockRow, rubroRow].filter(Boolean).slice(0, 3);
    const benefits = [
      normalized.destacado ? { icon: 'check', label: 'DESTACADO', value: 'PRODUCTO DESTACADO' } : null,
      normalized.masVendido ? { icon: 'check', label: 'MAS VENDIDO', value: 'ALTA ROTACION' } : null,
      normalized.oferta ? { icon: 'bolt', label: 'EN OFERTA', value: normalized.ofertaPct > 0 ? `${normalized.ofertaPct}% DE DESCUENTO` : 'PRECIO ESPECIAL' } : null,
      normalized.ceramico ? { icon: 'check', label: 'CERAMICO', value: normalized.ceramicoM2 > 0 ? `${normalized.ceramicoM2} M2 POR CAJA` : 'POR CAJA' } : null
    ].filter(Boolean).slice(0, 4);

    return {
      article: normalized,
      fields: {
        brand: '',
        model: normalized.codigo,
        title1: title.title1 || normalized.nombre.toUpperCase(),
        title2: title.title2,
        description: normalized.detalle || normalized.rubro || '',
        badgeTitle: normalized.rubro ? 'RUBRO' : '',
        badgeValue: normalized.rubro || ''
      },
      rows: { highlights, specs, benefits },
      imageUrl: normalized.fotoUrl,
      createdAt: new Date().toISOString()
    };
  }

  function setImageGeneratorCatalog(articles = []) {
    const catalog = (articles || []).map(imageGeneratorNormalizeArticle).filter((article) => article.codigo || article.nombre);
    try {
      localStorage.setItem(IMAGE_GENERATOR_CATALOG_KEY, JSON.stringify({ savedAt: Date.now(), articles: catalog }));
    } catch (e) {}
    return catalog;
  }

  function getImageGeneratorCatalog() {
    try {
      const parsed = JSON.parse(localStorage.getItem(IMAGE_GENERATOR_CATALOG_KEY) || '{}');
      return Array.isArray(parsed.articles) ? parsed.articles : [];
    } catch (e) {
      return [];
    }
  }

  function setImageGeneratorPayload(articleOrPayload = {}) {
    const payload = articleOrPayload.fields ? articleOrPayload : buildImageGeneratorPayload(articleOrPayload);
    try {
      sessionStorage.setItem(IMAGE_GENERATOR_PAYLOAD_KEY, JSON.stringify(payload));
      localStorage.setItem(IMAGE_GENERATOR_PAYLOAD_KEY, JSON.stringify(payload));
    } catch (e) {}
    return payload;
  }

  function readImageGeneratorPayload(clearSession = false) {
    try {
      const raw = sessionStorage.getItem(IMAGE_GENERATOR_PAYLOAD_KEY) || localStorage.getItem(IMAGE_GENERATOR_PAYLOAD_KEY);
      if (clearSession) sessionStorage.removeItem(IMAGE_GENERATOR_PAYLOAD_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function openImageGenerator(articleOrPayload = {}, options = {}) {
    const payload = setImageGeneratorPayload(articleOrPayload);
    const code = payload?.article?.codigo || payload?.fields?.model || '';
    const url = `generador-imagen-producto.html${code ? `?articulo=${encodeURIComponent(code)}` : ''}`;
    if (options.open === false) return { payload, url };
    const target = options.target || '_blank';
    const features = options.features || 'width=1280,height=900,resizable=yes,scrollbars=yes';
    return window.open(url, target, features);
  }

  function getByHeader(obj, names) {
    const keys = Object.keys(obj || {});
    for (const name of names) {
      const exact = keys.find((key) => key === name);
      if (exact) return obj[exact];
      const loose = keys.find((key) => norm(key) === norm(name));
      if (loose) return obj[loose];
    }
    return '';
  }

  function providerFromObject(obj) {
    const provider = {
      id_proveedor: String(getByHeader(obj, ['ID Proveedor', 'id_proveedor', 'idprov'])).trim(),
      proveedor: String(getByHeader(obj, ['Proveedor', 'proveedor'])).trim(),
      descuento_factura: Number(getByHeader(obj, ['Descuento En Factura', 'descuento_factura'])) || 0,
      descuento_lista: Number(getByHeader(obj, ['Descuento En Lista', 'descuento_lista'])) || 0,
      ultima_actualizacion: dateOnly(getByHeader(obj, ['Ultima actualizacion', 'ultima_actualizacion'])),
      vendedor: String(getByHeader(obj, ['Vendedor', 'vendedor'])).trim(),
      telefono: String(getByHeader(obj, ['Numero de Telefono', 'telefono'])).trim(),
      pagina_link: String(getByHeader(obj, ['Pagina', 'Página', 'Link pagina', 'Link página', 'pagina_link', 'pagina', 'web', 'reserva_texto_1'])).trim(),
      nota: String(getByHeader(obj, ['Nota', 'nota'])).trim(),
      porc_flete: Number(getByHeader(obj, ['Porc.Flete', 'porc_flete'])) || 0,
      porc_iva: Number(getByHeader(obj, ['Porc.IVA', 'porc_iva'])) || 0,
      iva_incluido: Boolean(getByHeader(obj, ['Iva Incluido?', 'iva_incluido'])),
      descuento_total_fc: Number(getByHeader(obj, ['Descuento En Total FC', 'Descuento Final Factura', 'descuento_total_fc', 'descuento_final_factura'])) || null
    };
    provider.proveedor_norm = norm(provider.proveedor);
    return provider.id_proveedor && provider.proveedor ? provider : null;
  }

  const PROVIDER_REMOTE_COLUMNS = [
    'id_proveedor', 'proveedor', 'descuento_factura', 'descuento_lista', 'ultima_actualizacion',
    'vendedor', 'telefono', 'nota', 'porc_flete', 'porc_iva', 'iva_incluido',
    'descuento_total_fc', 'proveedor_norm', 'reserva_texto_1', 'reserva_texto_2',
    'reserva_texto_3', 'reserva_texto_4', 'reserva_numero_1', 'reserva_numero_2',
    'reserva_numero_3', 'reserva_fecha_1', 'reserva_fecha_2', 'reserva_json_1'
  ];

  function normalizeProviderPageLink(provider) {
    if (!provider) return provider;
    const link = String(provider.pagina_link || provider.pagina || provider.web || provider.reserva_texto_1 || '').trim();
    const descuentoTotalFc = provider.descuento_total_fc ?? provider.descuento_final_factura ?? null;
    const normalized = { ...provider, descuento_total_fc: descuentoTotalFc };
    return link ? { ...normalized, pagina_link: link, reserva_texto_1: link } : { ...normalized, pagina_link: '', reserva_texto_1: provider.reserva_texto_1 || null };
  }

  function providerRemotePayload(provider) {
    const normalized = normalizeProviderPageLink(provider) || {};
    const payload = {};
    for (const column of PROVIDER_REMOTE_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(normalized, column)) payload[column] = normalized[column];
    }
    payload.reserva_texto_1 = normalized.pagina_link || normalized.reserva_texto_1 || null;
    return payload;
  }

  function openDb(name, upgrade, version = 1) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => upgrade(request.result, request.transaction);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function openProvidersDb() {
    return openDb(PROVIDERS_DB, (database) => {
      if (!database.objectStoreNames.contains('data')) database.createObjectStore('data', { keyPath: 'id_proveedor' });
    });
  }

  async function getProvidersCache() {
    const database = await openProvidersDb();
    return new Promise((resolve, reject) => {
      const request = database.transaction('data').objectStore('data').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function setProvidersCache(data) {
    const database = await openProvidersDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('data', 'readwrite');
      const store = tx.objectStore('data');
      store.clear();
      data.forEach((item) => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function putProviderCacheItem(item) {
    const database = await openProvidersDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('data', 'readwrite');
      tx.objectStore('data').put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function fetchAll(table, query) {
    let from = 0;
    const out = [];
    while (true) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: headers({ Range: `${from}-${from + 999}` }) });
      if (!response.ok) throw new Error(await response.text());
      const part = await response.json();
      out.push(...part);
      if (part.length < 1000) return out;
      from += 1000;
    }
  }

  async function importProvidersCloud() {
    const providers = (await fetchAll(TABLES.providers, 'select=*&order=proveedor.asc')).map(normalizeProviderPageLink);
    if (providers.length) await setProvidersCache(providers);
    return providers;
  }

  async function uploadProviders(data, fileName = '') {
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providers}?id_proveedor=not.is.null`, { method: 'DELETE', headers: headers() });
    for (let i = 0; i < data.length; i += 1000) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providers}?on_conflict=id_proveedor`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(data.slice(i, i + 1000).map(providerRemotePayload))
      });
      if (!response.ok) throw new Error(await response.text());
    }
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providersMeta}?on_conflict=id`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ id: 'principal', version: Date.now(), total_proveedores: data.length, archivo_nombre: fileName })
    });
    await setProvidersCache(data.map(normalizeProviderPageLink));
  }

  async function updateProviderDateOnly(provider, timestamp = nowTimestamp()) {
    const value = timestamp;
    const updated = { ...provider, ultima_actualizacion: value };
    await putProviderCacheItem(updated);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.providers}?id_proveedor=eq.${encodeURIComponent(provider.id_proveedor)}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ ultima_actualizacion: value })
    });
    if (!response.ok) throw new Error(await response.text());
    return value;
  }

  function priceListMetaPayload(extra = {}) {
    const payload = { id: 'principal', lista_version: Date.now(), ...extra };
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) delete payload[key];
    });
    return payload;
  }

  async function touchPriceListMeta(extra = {}) {
    const payload = priceListMetaPayload(extra);
    let response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?on_conflict=id`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(payload)
    });
    if (!response.ok && payload.reserva_json_1) {
      const text = await response.clone().text();
      if (text.includes('reserva_json_1')) {
        const fallback = { ...payload };
        fallback.importado_por = fallback.importado_por || fallback.reserva_json_1;
        delete fallback.reserva_json_1;
        response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?on_conflict=id`, {
          method: 'POST',
          headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(fallback)
        });
      }
    }
    if (!response.ok) throw new Error(await response.text());
    return payload;
  }

  function manifestUrlFromMetaValue(value) {
    const text = String(value || '').trim();
    return text.startsWith(PROVIDER_MANIFEST_PREFIX) ? text.slice(PROVIDER_MANIFEST_PREFIX.length) : '';
  }
  function fullManifestUrlFromMetaValue(value) {
    const text = String(value || '').trim();
    return text.startsWith(FULL_PROVIDER_MANIFEST_PREFIX) ? text.slice(FULL_PROVIDER_MANIFEST_PREFIX.length) : '';
  }

  async function remotePriceListMeta() {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?id=eq.principal&select=lista_version,total_articulos,archivo_nombre,importado_por,updated_at&limit=1`, {
      headers: headers()
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json())?.[0] || null;
  }

  function jsonByteLength(text) {
    return new TextEncoder().encode(String(text || '')).length;
  }

  function splitJsonRows(rows = [], maxBytes = CLOUDINARY_JSON_MAX_BYTES) {
    const chunks = [];
    let current = [];
    let currentBytes = 2;
    for (const row of rows) {
      const rowText = JSON.stringify(row);
      const rowBytes = jsonByteLength(rowText);
      const separatorBytes = current.length ? 1 : 0;
      if (current.length && currentBytes + separatorBytes + rowBytes > maxBytes) {
        chunks.push(current);
        current = [];
        currentBytes = 2;
      }
      current.push(row);
      currentBytes += (current.length > 1 ? 1 : 0) + rowBytes;
    }
    if (current.length || !chunks.length) chunks.push(current);
    return chunks;
  }

  async function uploadRawJsonTextToCloudinary(jsonText, publicId) {
    const formData = new FormData();
    formData.append('file', new Blob([jsonText], { type: 'application/json' }), `${publicId}.json`);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('public_id', publicId);
    formData.append('resource_type', 'raw');
    const response = await fetch(CLOUDINARY_RAW_UPLOAD_URL, { method: 'POST', body: formData });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!response.ok) throw new Error(data?.error?.message || text || 'Error subiendo JSON');
    if (!data?.secure_url) throw new Error('Cloudinary no devolvio URL del JSON');
    return data.secure_url;
  }

  async function uploadRawJsonToCloudinary(payload, publicId) {
    return uploadRawJsonTextToCloudinary(JSON.stringify(payload), publicId);
  }

  async function uploadProviderRowsJsonChunks(rows, basePublicId) {
    const chunks = splitJsonRows(rows);
    const uploaded = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const suffix = chunks.length > 1 ? `_parte_${index + 1}` : '';
      const jsonUrl = await uploadRawJsonToCloudinary(chunks[index], `${basePublicId}${suffix}`);
      uploaded.push({
        index: index + 1,
        total: chunks.length,
        rows: chunks[index].length,
        json_url: jsonUrl
      });
    }
    return uploaded;
  }

  function providerJsonTableEntryFromManifestEntry(entry) {
    return {
      id_proveedor: cleanId(entry?.id_proveedor),
      proveedor: String(entry?.proveedor || '').trim(),
      json_url: String(entry?.json_url || '').trim(),
      chunks: Array.isArray(entry?.chunks) ? entry.chunks : [],
      chunk_count: Number(entry?.chunk_count || entry?.chunks?.length || 1) || 1,
      total_articulos: Number(entry?.total_articulos || 0) || 0,
      version: Number(entry?.version || 0) || 0,
      fecha_actualizacion: entry?.updated_at || new Date().toISOString(),
      manifest_updated_at: new Date().toISOString()
    };
  }

  function providerJsonManifestFromTableRows(rows = []) {
    const providers = {};
    for (const row of rows || []) {
      const id = cleanId(row?.id_proveedor);
      if (!id) continue;
      const chunks = Array.isArray(row?.chunks) ? row.chunks : [];
      providers[id] = {
        id_proveedor: id,
        proveedor: row?.proveedor || '',
        version: Number(row?.version || 0),
        updated_at: row?.fecha_actualizacion || row?.updated_at || '',
        total_articulos: Number(row?.total_articulos || 0),
        json_url: row?.json_url || chunks[0]?.json_url || '',
        chunk_count: Number(row?.chunk_count || chunks.length || 1),
        chunks
      };
    }
    return {
      id: 'provider-json-table-v1',
      version: Object.values(providers).reduce((max, entry) => Math.max(max, Number(entry.version || 0)), 0),
      updated_at: new Date().toISOString(),
      total_articulos: Object.values(providers).reduce((sum, entry) => sum + (Number(entry.total_articulos || 0) || 0), 0),
      providers
    };
  }

  async function upsertProviderJsonTableEntry(entry) {
    const payload = providerJsonTableEntryFromManifestEntry(entry);
    if (!payload.id_proveedor) return null;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListJsonProviders}?on_conflict=id_proveedor`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json())?.[0] || payload;
  }

  async function fetchProviderJsonTableRows(query = '') {
    const select = 'select=id_proveedor,proveedor,json_url,chunks,chunk_count,total_articulos,version,fecha_actualizacion,updated_at';
    const suffix = query ? `&${query}` : '&order=proveedor.asc';
    return fetchAll(TABLES.priceListJsonProviders, `${select}${suffix}`);
  }

  async function fetchProviderJsonTableManifest() {
    const rows = await fetchProviderJsonTableRows();
    return providerJsonManifestFromTableRows(rows);
  }

  async function loadProviderJsonManifest() {
    const meta = await remotePriceListMeta().catch(() => null);
    const manifestUrl = manifestUrlFromMetaValue(meta?.archivo_nombre);
    if (!manifestUrl) {
      return {
        meta,
        manifest: { id: 'provider-json-manifest-v1', version: 0, updated_at: '', providers: {} },
        manifestUrl: ''
      };
    }
    const response = await fetch(`${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
    if (!response.ok) throw new Error(await response.text());
    const manifest = await response.json();
    return {
      meta,
      manifest: {
        id: 'provider-json-manifest-v1',
        version: Number(manifest?.version || 0),
        updated_at: manifest?.updated_at || '',
        providers: manifest?.providers && typeof manifest.providers === 'object' ? manifest.providers : {}
      },
      manifestUrl
    };
  }
  async function loadFullProviderJsonManifest(meta) {
    const manifestUrl = fullManifestUrlFromMetaValue(meta?.reserva_json_1 || meta?.importado_por);
    if (!manifestUrl) return null;
    const response = await fetch(`${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
    if (!response.ok) return null;
    const manifest = await response.json();
    return {
      id: 'provider-json-manifest-v1',
      version: Number(manifest?.version || 0),
      updated_at: manifest?.updated_at || '',
      total_articulos: Number(manifest?.total_articulos || 0),
      providers: manifest?.providers && typeof manifest.providers === 'object' ? manifest.providers : {}
    };
  }

  function providerArticleJsonRows(providerId, articles = []) {
    const id = cleanId(providerId);
    const baseOrder = Date.now() * 1000;
    return (articles || []).map((article, index) => ({
      idorden: Number(article.idorden || 0) || baseOrder + index,
      cod_proveedor: String(article.cod_proveedor || article.codProv || '').trim(),
      articulo: String(article.articulo || article.descripcion || '').trim(),
      precio_costo: Number(article.precio_costo ?? article.precioCosto ?? 0) || 0,
      id_proveedor: cleanId(article.id_proveedor || article.idProveedor || id),
      proveedor: String(article.proveedor || '').trim(),
      cod_proveedor_norm: norm(article.cod_proveedor_norm || article.cod_proveedor || article.codProv || ''),
      articulo_norm: norm(article.articulo_norm || article.articulo || article.descripcion || ''),
      proveedor_norm: norm(article.proveedor_norm || article.proveedor || ''),
      articulo_source: article.articulo_source || 'actualizar_articulos_json'
    }));
  }

  function providerJsonUrlsFromEntry(entry) {
    const chunks = Array.isArray(entry?.chunks) ? entry.chunks.map((chunk) => String(chunk?.json_url || '').trim()).filter(Boolean) : [];
    return chunks.length ? chunks : [String(entry?.json_url || '').trim()].filter(Boolean);
  }

  async function fetchProviderJsonRowsForEntry(entry) {
    const urls = providerJsonUrlsFromEntry(entry);
    const out = [];
    for (const url of urls) {
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(entry?.version || '')}`);
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      if (Array.isArray(rows)) out.push(...rows);
    }
    return out;
  }

  function providerJsonMergeKey(row) {
    const byCode = norm(row?.cod_proveedor || row?.codProv || row?.codprov || '');
    if (byCode) return `cod:${byCode}`;
    const byArticle = norm(row?.articulo || row?.descripcion || row?.nombre || '');
    return byArticle ? `art:${byArticle}` : '';
  }

  function mergeProviderJsonRows(existingRows, incomingRows) {
    const map = new Map();
    const order = [];
    (existingRows || []).forEach((row) => {
      const normalized = providerArticleJsonRows(row?.id_proveedor, [row])[0];
      const key = providerJsonMergeKey(normalized);
      if (!key) return;
      if (!map.has(key)) order.push(key);
      map.set(key, normalized);
    });
    (incomingRows || []).forEach((row) => {
      const key = providerJsonMergeKey(row);
      if (!key) return;
      const previous = map.get(key);
      if (!previous) order.push(key);
      map.set(key, {
        ...row,
        idorden: Number(previous?.idorden || row.idorden || 0) || Date.now() * 1000 + order.length
      });
    });
    return order.map((key) => map.get(key)).filter(Boolean);
  }

  async function publishProviderArticlesJson(providerId, articles = [], options = {}) {
    const id = cleanId(providerId);
    if (!id) throw new Error('Proveedor sin ID para publicar JSON');
    let rows = providerArticleJsonRows(id, articles);
    const version = Date.now();
    const loaded = await loadProviderJsonManifest();
    if (options?.mergeExisting) {
      const tableManifest = await fetchProviderJsonTableManifest().catch(() => null);
      const existingEntry = tableManifest?.providers?.[id] || loaded.manifest?.providers?.[id] || null;
      if (existingEntry) {
        const existingRows = await fetchProviderJsonRowsForEntry(existingEntry).catch((error) => {
          console.warn(error);
          return [];
        });
        rows = mergeProviderJsonRows(existingRows, rows);
      }
    }
    const providerName = String(rows.find((row) => row.proveedor)?.proveedor || articles.find((row) => row?.proveedor)?.proveedor || '').trim();
    const chunks = await uploadProviderRowsJsonChunks(rows, `listas_proveedores/proveedor_${id}_${version}`);
    const jsonUrl = chunks[0]?.json_url || '';
    const manifest = loaded.manifest || { id: 'provider-json-manifest-v1', providers: {} };
    const providers = { ...(manifest.providers || {}) };
    providers[id] = {
      id_proveedor: id,
      proveedor: providerName,
      version,
      updated_at: new Date().toISOString(),
      total_articulos: rows.length,
      json_url: jsonUrl,
      chunk_count: chunks.length,
      chunks
    };
    const nextManifest = {
      id: 'provider-json-manifest-v1',
      version,
      updated_at: new Date().toISOString(),
      providers
    };
    const manifestUrl = await uploadRawJsonToCloudinary(nextManifest, `listas_proveedores/manifest_${version}`);
    let fullManifestUrl = '';
    const fullManifest = await loadFullProviderJsonManifest(loaded.meta).catch(() => null);
    const fullProviders = { ...(fullManifest?.providers || providers) };
    fullProviders[id] = providers[id];
    const nextFullManifest = {
      id: 'provider-json-manifest-v1',
      version,
      updated_at: new Date().toISOString(),
      total_articulos: Object.values(fullProviders).reduce((sum, entry) => sum + (Number(entry?.total_articulos || 0) || 0), 0),
      providers: fullProviders
    };
    fullManifestUrl = await uploadRawJsonToCloudinary(nextFullManifest, `listas_proveedores/manifest_completo_${version}`);
    await upsertProviderJsonTableEntry(providers[id]);
    return { manifest: nextManifest, manifestUrl, fullManifestUrl, entry: providers[id] };
  }

  async function replaceProviderArticlesSupabase(providerId, articles, onProgress = null) {
    const del = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceList}?id_proveedor=eq.${encodeURIComponent(providerId)}`, { method: 'DELETE', headers: headers() });
    if (!del.ok) throw new Error(await del.text());
    if (typeof onProgress === 'function') onProgress(0, articles.length);
    for (let i = 0; i < articles.length; i += 1000) {
      const chunk = articles.slice(i, i + 1000).map((article, n) => ({
        ...article,
        idorden: Number(article.idorden || 0) || Date.now() * 1000 + i + n,
        articulo_source: article.articulo_source || 'actualizar_articulos'
      }));
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceList}?on_conflict=idorden`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(chunk)
      });
      if (!response.ok) throw new Error(await response.text());
      if (typeof onProgress === 'function') onProgress(Math.min(i + 1000, articles.length), articles.length);
    }
  }

  async function replaceProviderArticles(providerId, articles, onProgress = null, options = {}) {
    const id = cleanId(providerId);
    const rows = providerArticleJsonRows(id, articles).map((row) => ({ ...row, articulo_source: 'actualizar_articulos' }));
    if (typeof onProgress === 'function') onProgress(0, rows.length);
    try {
      const published = await publishProviderArticlesJson(id, rows, options);
      if (typeof onProgress === 'function') onProgress(rows.length, rows.length);
      await touchPriceListMeta({
        lista_version: published.manifest.version,
        archivo_nombre: `${PROVIDER_MANIFEST_PREFIX}${published.manifestUrl}`,
        importado_por: published.fullManifestUrl ? `${FULL_PROVIDER_MANIFEST_PREFIX}${published.fullManifestUrl}` : undefined
      });
      return published;
    } catch (error) {
      console.warn(error);
      if (options?.mergeExisting) throw error;
      await replaceProviderArticlesSupabase(id, rows, onProgress);
      await touchPriceListMeta();
      return null;
    }
  }

  function xmlCell(value, type = 'String') {
    const text = String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<Cell><Data ss:Type="${type}">${text}</Data></Cell>`;
  }

  function buildArticlesXlsBlob(articles) {
    const headers = ['IDArt', 'CodProveedor', 'Articulo', 'CodBarra', 'PrecioCosto', 'preciolista', 'PrecioVta', 'IDProveedor', 'IDRubro', 'IDMoneda', 'Nota', 'PorcIVA'];
    const rows = [headers, ...articles.map((article) => [
      '',
      article.cod_proveedor || '',
      article.articulo || '',
      '',
      Number(article.precio_costo || 0),
      '',
      '',
      article.id_proveedor || '',
      '',
      '',
      '',
      ''
    ])];

    if (window.XLSX) {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Hoja1');
      const output = XLSX.write(workbook, { bookType: 'biff8', type: 'array' });
      return new Blob([output], { type: 'application/vnd.ms-excel' });
    }

    const out = [
      '<?xml version="1.0"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Worksheet ss:Name="Hoja1"><Table>',
      '<Row>' + headers.map((header) => xmlCell(header)).join('') + '</Row>'
    ];
    for (const article of articles) {
      out.push(
        '<Row>',
        xmlCell(''),
        xmlCell(article.cod_proveedor || ''),
        xmlCell(article.articulo || ''),
        xmlCell(''),
        xmlCell(Number(article.precio_costo || 0), 'Number'),
        xmlCell(''),
        xmlCell(''),
        xmlCell(article.id_proveedor || ''),
        xmlCell(''),
        xmlCell(''),
        xmlCell(''),
        xmlCell(''),
        '</Row>'
      );
    }
    out.push('</Table></Worksheet></Workbook>');
    return new Blob([out.join('')], { type: 'application/vnd.ms-excel;charset=utf-8' });
  }

  async function saveBlobAs(blob, fileName) {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Excel 97-2003', accept: { 'application/vnd.ms-excel': ['.xls'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }

  const CATALOG = (() => {
    const DB_NAME = 'corralon_catalogo_articulos_v1';
    const DB_VERSION = 1;
    const CACHE_ID = 'principal';
    const PAGE_SIZE = 1000;
    const INITIAL_PAGE_SIZE = 120;
    const FIRESTORE_PROJECT = 'corralon-progreso';
    const FIRESTORE_API_KEY = 'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0';
    const SELECT_COLUMNS = [
      'codigo', 'codigo_proveedor', 'id_proveedor', 'nombre', 'rubro',
      'precio_compra_sin_descuento', 'precio_compra_con_impuestos',
      'porcentaje_ganancia_min', 'precio_venta', 'stock',
      'stock_progreso', 'stock_calle5',
      'sync_version', 'source_file', 'updated_at'
    ].join(',');
    let activeFullLoad = null;
    let memoryCache = null;

    function openCatalogDb() {
      return openDb(DB_NAME, (database) => {
        if (!database.objectStoreNames.contains('cache')) database.createObjectStore('cache', { keyPath: 'id' });
      }, DB_VERSION);
    }

    async function readCache() {
      if (memoryCache) return memoryCache;
      try {
        const database = await openCatalogDb();
        memoryCache = await new Promise((resolve, reject) => {
          const request = database.transaction('cache').objectStore('cache').get(CACHE_ID);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
        return memoryCache;
      } catch (error) {
        console.warn('No se pudo leer la cache del catalogo', error);
        return null;
      }
    }

    async function writeCache(payload) {
      memoryCache = { id: CACHE_ID, ...payload, savedAt: Date.now() };
      try {
        const database = await openCatalogDb();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('cache', 'readwrite');
          transaction.objectStore('cache').put(memoryCache);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
      } catch (error) {
        console.warn('No se pudo guardar la cache del catalogo', error);
      }
    }

    async function getConfigUrl(docId) {
      const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/config/${encodeURIComponent(docId)}?key=${FIRESTORE_API_KEY}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return '';
      const payload = await response.json();
      return String(payload?.fields?.url?.stringValue || '').trim();
    }

    async function fetchJson(url) {
      if (!url) return [];
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return Array.isArray(payload) ? payload : [];
    }

    function codeOf(article = {}) {
      return String(article.codigo ?? article.idart ?? article.idArt ?? article.id ?? '').trim();
    }

    function metaMap(rows = []) {
      const map = new Map();
      for (const row of rows || []) {
        const code = codeOf(row);
        if (code) map.set(code, row);
      }
      return map;
    }

    function fromSupabase(row = {}) {
      const codigo = String(row.codigo || '').trim();
      const codigoProveedor = String(row.codigo_proveedor || '').trim();
      const idProveedor = String(row.id_proveedor || '').trim();
      const nombre = String(row.nombre || '').trim();
      const precioCosto = Number(row.precio_compra_sin_descuento || 0);
      const precioCpraCI = Number(row.precio_compra_con_impuestos || 0);
      const precioVenta = Number(row.precio_venta || 0);
      const progreso = row.stock_progreso === null || row.stock_progreso === undefined ? '' : Number(row.stock_progreso);
      const calle5 = row.stock_calle5 === null || row.stock_calle5 === undefined ? '' : Number(row.stock_calle5);
      return {
        codigo,
        idart: codigo,
        idArt: codigo,
        idartprov: codigoProveedor,
        codprov: codigoProveedor,
        id_proveedor: idProveedor,
        idProveedor,
        nombre,
        descripcion: nombre,
        rubro: String(row.rubro || ''),
        precio: precioVenta,
        precioCosto,
        precio_costo: precioCosto,
        PrecioCpraSISDto: precioCosto,
        PrecioCpraCI: precioCpraCI,
        PrecioVta3: precioVenta,
        PorcGanMin: Number(row.porcentaje_ganancia_min || 0),
        stock: row.stock === null || row.stock === undefined ? '' : Number(row.stock),
        stockSucursalProgresoRuta: progreso,
        stockSucursalCalle5Espana: calle5,
        sourceRows: Array.isArray(row.source_rows) ? row.source_rows : [],
        source_rows: Array.isArray(row.source_rows) ? row.source_rows : [],
        syncVersion: Number(row.sync_version || 0),
        sourceFile: String(row.source_file || ''),
        updatedAt: row.updated_at || ''
      };
    }

    function mergeMetadata(baseRows = [], metadataRows = []) {
      const byCode = metaMap(metadataRows);
      return (baseRows || []).map((raw) => {
        const base = raw?.codigo_proveedor !== undefined || raw?.precio_venta !== undefined ? fromSupabase(raw) : { ...raw };
        const code = codeOf(base);
        const meta = byCode.get(code);
        return meta ? { ...base, ...meta, codigo: code, idart: code, idArt: code } : base;
      });
    }

    async function fetchMetaRow() {
      const query = `${SUPABASE_URL}/rest/v1/${TABLES.catalogMeta}?id=eq.principal&select=*`;
      const response = await fetch(query, { headers: headers(), cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    }

    function supabaseCatalogQuery(extra = '') {
      return `${SUPABASE_URL}/rest/v1/${TABLES.catalog}?select=${encodeURIComponent(SELECT_COLUMNS)}&activo=eq.true${extra}&order=codigo.asc`;
    }

    async function fetchSupabaseRange(from = 0, to = from + PAGE_SIZE - 1) {
      const response = await fetch(supabaseCatalogQuery(), {
        headers: headers({ Range: `${from}-${to}` }),
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Respuesta de catalogo invalida');
      return rows;
    }

    async function fetchSupabaseCodes(codes = []) {
      const uniqueCodes = [...new Set((codes || []).map((code) => String(code || '').trim()).filter(Boolean))];
      if (!uniqueCodes.length) return [];
      const chunks = [];
      for (let index = 0; index < uniqueCodes.length; index += 60) chunks.push(uniqueCodes.slice(index, index + 60));
      const pages = await Promise.all(chunks.map(async (chunk) => {
        const filter = `&codigo=${encodeURIComponent(`in.(${chunk.map((code) => JSON.stringify(code)).join(',')})`)}`;
        const response = await fetch(supabaseCatalogQuery(filter), {
          headers: headers(),
          cache: 'no-store'
        });
        if (!response.ok) throw new Error(await response.text());
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('Respuesta inicial de catalogo invalida');
        return rows;
      }));
      return pages.flat();
    }

    async function fetchSupabaseInitialRows(priorityCodes = [], limit = INITIAL_PAGE_SIZE) {
      const safeLimit = Math.max(24, Math.min(300, Number(limit || INITIAL_PAGE_SIZE)));
      const [priorityRows, firstRows] = await Promise.all([
        fetchSupabaseCodes(priorityCodes),
        fetchSupabaseRange(0, safeLimit - 1)
      ]);
      const merged = new Map();
      priorityRows.forEach((row) => merged.set(String(row?.codigo || '').trim(), row));
      firstRows.forEach((row) => merged.set(String(row?.codigo || '').trim(), row));
      return [...merged.values()].slice(0, safeLimit);
    }

    async function fetchSupabaseRows() {
      const result = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const to = from + PAGE_SIZE - 1;
        const rows = await fetchSupabaseRange(from, to);
        result.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return result;
    }

    function enabledMetadataFlag(value) {
      if (value === true || value === 1) return true;
      return ['1', 'true', 'si', 'sí', 'x'].includes(String(value ?? '').trim().toLowerCase());
    }

    function priorityCodesFromMetadata(metadataRows = [], suppliedCodes = []) {
      const result = [];
      const seen = new Set();
      const add = (value) => {
        const code = String(value || '').trim();
        if (!code || seen.has(code)) return;
        seen.add(code);
        result.push(code);
      };
      (suppliedCodes || []).forEach(add);
      (metadataRows || []).forEach((row) => {
        const isHomeArticle = enabledMetadataFlag(row?.oferta ?? row?.enOferta ?? row?.tagOferta)
          || enabledMetadataFlag(row?.destacado ?? row?.tagDestacado)
          || enabledMetadataFlag(row?.masVendido ?? row?.mas_vendido ?? row?.tagMasVendido)
          || enabledMetadataFlag(row?.accesoRapido ?? row?.rapido ?? row?.tagRapido ?? row?.quickAccess);
        if (isHomeArticle) add(codeOf(row));
      });
      return result;
    }

    async function loadFallback() {
      const [baseUrl, metaUrl] = await Promise.all([
        getConfigUrl('listaActual'),
        getConfigUrl('listaMetaArticulos').catch(() => '')
      ]);
      const [baseRows, metadataRows] = await Promise.all([
        fetchJson(baseUrl),
        metaUrl ? fetchJson(metaUrl).catch(() => []) : Promise.resolve([])
      ]);
      return { rows: mergeMetadata(baseRows, metadataRows), baseUrl, metaUrl };
    }

    async function catalogContext(cachedValue) {
      const cached = cachedValue === undefined ? await readCache() : cachedValue;
      let metaRow = null;
      let metadataUrl = '';
      try {
        [metaRow, metadataUrl] = await Promise.all([
          fetchMetaRow(),
          getConfigUrl('listaMetaArticulos').catch(() => '')
        ]);
      } catch (error) {
        console.warn('No se pudo consultar la version del catalogo', error);
      }
      const version = Number(metaRow?.version || 0);
      if (!metadataUrl) metadataUrl = String(cached?.metadataUrl || '');
      return {
        cached,
        metaRow,
        metadataUrl,
        version,
        versionKnown: Boolean(metaRow),
        signature: `${version}|${metadataUrl}`
      };
    }

    function startFullLoad(context, options = {}) {
      const allowFallback = options.fallback !== false;
      const loadKey = `${context.signature}|${allowFallback ? 'fallback' : 'direct'}`;
      if (activeFullLoad?.key === loadKey) return activeFullLoad.promise;
      const metadataPromise = options.metadataPromise || (
        context.metadataUrl ? fetchJson(context.metadataUrl).catch(() => []) : Promise.resolve([])
      );
      const promise = (async () => {
        try {
          const [baseRows, metadataRows] = await Promise.all([
            fetchSupabaseRows(),
            metadataPromise
          ]);
          if (!baseRows.length) throw new Error('El catalogo de Supabase todavia esta vacio');
          const rows = mergeMetadata(baseRows, metadataRows);
          await writeCache({
            signature: context.signature,
            version: context.version,
            metadataUrl: context.metadataUrl,
            rows,
            source: 'supabase'
          });
          window.dispatchEvent(new CustomEvent('corralon:catalog-ready', {
            detail: { rows, version: context.version, source: 'supabase' }
          }));
          return rows;
        } catch (error) {
          console.warn('Catalogo Supabase no disponible; se usa el respaldo JSON', error);
          if (allowFallback) {
            try {
              const fallback = await loadFallback();
              if (fallback.rows.length) {
                await writeCache({
                  signature: `fallback|${fallback.baseUrl}|${fallback.metaUrl}`,
                  version: context.version,
                  metadataUrl: fallback.metaUrl,
                  rows: fallback.rows,
                  source: 'cloudinary'
                });
                return fallback.rows;
              }
            } catch (fallbackError) {
              console.warn('Respaldo JSON no disponible', fallbackError);
            }
          }
          return Array.isArray(context.cached?.rows) ? context.cached.rows : [];
        }
      })();
      activeFullLoad = { key: loadKey, promise };
      const clearActiveLoad = () => {
        if (activeFullLoad?.promise === promise) activeFullLoad = null;
      };
      promise.then(clearActiveLoad, clearActiveLoad);
      return promise;
    }

    async function loadProgressive(options = {}) {
      const force = Boolean(options.force);
      const cached = await readCache();
      if (!force && Array.isArray(cached?.rows) && cached.rows.length) {
        const complete = (async () => {
          const context = await catalogContext(cached);
          if (!context.versionKnown || cached.signature === context.signature) return cached.rows;
          const metadataPromise = context.metadataUrl
            ? fetchJson(context.metadataUrl).catch(() => [])
            : Promise.resolve([]);
          return startFullLoad(context, { ...options, metadataPromise });
        })();
        return {
          initialRows: cached.rows,
          complete,
          fromCache: true,
          version: Number(cached.version || 0)
        };
      }

      const context = await catalogContext(cached);
      const metadataPromise = context.metadataUrl
        ? fetchJson(context.metadataUrl).catch(() => [])
        : Promise.resolve([]);

      let initialRows = [];
      try {
        const metadataRows = await metadataPromise;
        const priorityCodes = priorityCodesFromMetadata(metadataRows, options.priorityCodes);
        const baseRows = await fetchSupabaseInitialRows(priorityCodes, options.initialLimit);
        initialRows = mergeMetadata(baseRows, metadataRows);
      } catch (error) {
        console.warn('No se pudo preparar la portada del catalogo', error);
      }
      return {
        initialRows,
        complete: startFullLoad(context, { ...options, metadataPromise }),
        fromCache: false,
        version: context.version
      };
    }

    async function load(options = {}) {
      const progressive = await loadProgressive(options);
      return progressive.complete;
    }

    async function clearCache() {
      memoryCache = null;
      try {
        const database = await openCatalogDb();
        await new Promise((resolve, reject) => {
          const request = database.transaction('cache', 'readwrite').objectStore('cache').delete(CACHE_ID);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.warn(error);
      }
    }

    return {
      load,
      loadProgressive,
      clearCache,
      getConfigUrl,
      fetchSupabaseInitialRows,
      fetchSupabaseRows,
      mergeMetadata,
      fromSupabase
    };
  })();

  const FALTANTES = (() => {
    const INDEX_CACHE_KEY = 'corralon_index_lista_articulos_cache_v1';
    const LIST_DB = 'corralon_lista_proveedores_v1';
    const PROVIDER_LIST_META_KEY = 'corralon_lista_proveedores_meta_v1';
    const LOCAL_KEY = 'corralon_faltantes_rows_v2';
    const COLLECTION = 'faltantes';
    const FIREBASE_CONFIG = {
      apiKey: 'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',
      authDomain: 'corralon-progreso.firebaseapp.com',
      projectId: 'corralon-progreso',
      storageBucket: 'corralon-progreso.firebasestorage.app',
      messagingSenderId: '466583614632',
      appId: '1:466583614632:web:42cb839f83e97475fabe9d'
    };
    let firebaseDb = null;

    function searchNorm(value) {
      return norm(value)
        .replace(/([0-9]+)([a-z]+)/g, '$1 $2')
        .replace(/([a-z]+)([0-9]+)/g, '$1 $2')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function makeLocalUid() {
      return crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function blankRow(columnFiltro = '', source = 'index') {
      return {
        id: '',
        localUid: makeLocalUid(),
        idart: '',
        idProveedor: '',
        codProv: '',
        filtro: columnFiltro,
        sucursalId: '',
        sucursal: '',
        proveedor: '',
        descripcion: '',
        cantidad: '',
        precioCosto: 0,
        precioFinal: 0,
        pedido: false,
        source
      };
    }

    function isBlank(row) {
      return !String(row?.idart || row?.codProv || row?.descripcion || row?.cantidad || '').trim() && !row?.pedido;
    }

    function withSearch(row) {
      row.idartNorm = searchNorm(row.idart);
      row.idProveedorNorm = searchNorm(row.idProveedor);
      row.codProvNorm = searchNorm(row.codProv);
      row.proveedorNorm = searchNorm(row.proveedor);
      row.descripcionNorm = searchNorm(row.descripcion);
      return row;
    }

    function normalizeIndexItem(item, index = 0) {
      const firstNumber = (...values) => {
        for (const value of values) {
          if (value === null || value === undefined || value === '') continue;
          const number = Number(value);
          if (Number.isFinite(number)) return number;
        }
        return 0;
      };
      const firstText = (...values) => {
        for (const value of values) {
          const text = String(value ?? '').trim();
          if (text) return text;
        }
        return '';
      };
      const idart = String(item.idArt || item.IDArt || item.id || item.codigo || item._codigoArticulo || index + 1).trim();
      const descripcion = String(item.descripcion || item.Descripcion || item.nombre || item.articulo || item._descripcionPrincipal || '').trim();
      const precioCosto = firstNumber(
        item.PrecioCpraSISDto,
        item.precioCpraSISDto,
        item.precio_cpra_sis_dto,
        item.precioCosto,
        item.precio_costo,
        item.PrecioCosto,
        item.costo,
        item.Costo,
        item.precio
      );
      const precioFinal = firstNumber(item.precioFinal, item.precioVigente, item.PrecioVta, item.precio, precioCosto);
      const codProv = String(
        item.idartprov || item.idArtProv || item.idart_prov || item.id_art_prov || item.artprov || item.idProveedorArticulo ||
        item.codprov || item.codProv || item.cod_prov || item.codigo_proveedor || item.codigoProveedor || item.codigo_prov ||
        item.codProveedor || item.CodProveedor || item.CodProveed || ''
      ).trim();
      const idProveedor = cleanId(firstText(
        item.id_proveedor,
        item.idProveedor,
        item.IDProveedor,
        item.IDPROVEEDOR,
        item['ID Proveedor'],
        item['Id Proveedor'],
        item['id proveedor'],
        item.idproveedor,
        item.idProveed,
        item.IDProveed,
        item.idproveed,
        item.idprov,
        item.id_cliente,
        item.idCliente,
        item.IDCliente
      ));
      const proveedor = firstText(
        item.proveedor,
        item.Proveedor,
        item.nombreProveedor,
        item.NombreProveedor,
        item.proveedor_nombre,
        item.nombre_proveedor,
        item.proveedorDescripcion,
        item.proveedor_descripcion,
        item.Proveedores_Descripcion,
        item.proveedores_descripcion,
        item.razonSocial,
        item.razon_social,
        item.RazonSocial,
        item.razonsocial,
        item.cliente,
        item.Cliente
      );
      return withSearch({
        source: 'index',
        idart,
        idProveedor,
        codProv,
        filtro: String(item.filtro || ''),
        proveedor,
        descripcion,
        precioCosto,
        precioFinal
      });
    }

    function normalizeProviderArticle(item) {
      return withSearch({
        source: 'proveedores',
        idart: String(item.idart || item.idorden || '').padStart(6, '0'),
        idProveedor: cleanId(item.id_proveedor || item.idProveedor || ''),
        codProv: String(item.cod_proveedor || '').trim(),
        filtro: String(item.filtro || ''),
        proveedor: String(item.proveedor || '').trim(),
        descripcion: String(item.articulo || '').trim(),
        precioCosto: Number(item.precio_costo || 0),
        precioFinal: Number(item.precio_final || item.precio_costo || 0)
      });
    }

    function rowFromRemote(item) {
      return {
        id: item.id || '',
        localUid: item.local_uid || makeLocalUid(),
        idart: item.idart || '',
        idProveedor: item.id_proveedor || item.idProveedor || '',
        codProv: item.cod_proveedor || '',
        filtro: item.filtro || '',
        sucursalId: item.sucursal_id || item.sucursalId || '',
        sucursal: item.sucursal || normalizeBranch(item.sucursal_id || item.sucursalId || ''),
        proveedor: item.proveedor || '',
        descripcion: item.descripcion || '',
        cantidad: item.cantidad ?? '',
        precioCosto: Number(item.precio_costo || 0),
        precioFinal: Number(item.precio_final || 0),
        pedido: Boolean(item.pedido),
        source: item.origen || 'index'
      };
    }

    function rowToRemote(row, orden = 0) {
      if (!row.localUid) row.localUid = makeLocalUid();
      return {
        local_uid: row.localUid,
        idart: row.idart || '',
        id_proveedor: row.idProveedor || '',
        cod_proveedor: row.codProv || '',
        filtro: row.filtro || '',
        sucursal_id: row.sucursalId || '',
        sucursal: normalizeBranch(row.sucursal || row.sucursalId || ''),
        proveedor: row.proveedor || '',
        descripcion: row.descripcion || '',
        cantidad: Number(row.cantidad || 0),
        precio_costo: Number(row.precioCosto || 0),
        precio_final: Number(row.precioFinal || 0),
        pedido: Boolean(row.pedido),
        origen: row.source || '',
        orden,
        updatedAt: window.firebase?.firestore?.FieldValue?.serverTimestamp ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now()
      };
    }

    function localFiltroKey() {
      return `${LOCAL_KEY}_filtro`;
    }

    function loadLocalRows() {
      try {
        return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') || [];
      } catch {
        return [];
      }
    }

    function saveLocalRows(rows, columnFiltro = '') {
      localStorage.setItem(localFiltroKey(), String(columnFiltro || ''));
      localStorage.setItem(LOCAL_KEY, JSON.stringify(rows || []));
    }

    function loadColumnFiltro() {
      return localStorage.getItem(localFiltroKey()) || '';
    }

    function firebaseDatabase() {
      if (firebaseDb) return firebaseDb;
      if (!window.firebase?.firestore) return null;
      if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
      firebaseDb = window.firebase.firestore();
      return firebaseDb;
    }

    function firebaseRowFromDoc(doc) {
      return rowFromRemote({ id: doc.id, ...doc.data() });
    }

    async function loadRemoteRows() {
      const db = firebaseDatabase();
      if (!db) return [];
      const snap = await db.collection(COLLECTION).orderBy('orden', 'asc').get();
      return snap.docs.map(firebaseRowFromDoc);
    }

    function subscribeRows(onRows, onError = console.warn) {
      const db = firebaseDatabase();
      if (!db) return null;
      return db.collection(COLLECTION).orderBy('orden', 'asc').onSnapshot(
        (snapshot) => onRows(snapshot.docs.map(firebaseRowFromDoc)),
        onError
      );
    }

    async function saveRows(rows) {
      const db = firebaseDatabase();
      if (!db) return;
      const filled = (rows || []).filter((row) => !isBlank(row));
      if (!filled.length) return;
      const batch = db.batch();
      filled.forEach((row, index) => {
        if (!row.localUid) row.localUid = makeLocalUid();
        batch.set(db.collection(COLLECTION).doc(row.localUid), rowToRemote(row, index), { merge: true });
      });
      await batch.commit();
    }

    async function addRow(row) {
      const item = {
        ...blankRow(row?.filtro || '', row?.source || 'proveedores'),
        ...row,
        localUid: row?.localUid || makeLocalUid(),
        pedido: Boolean(row?.pedido)
      };
      const localRows = loadLocalRows();
      localRows.push(item);
      saveLocalRows(localRows, loadColumnFiltro());
      const db = firebaseDatabase();
      if (db) await db.collection(COLLECTION).doc(item.localUid).set(rowToRemote(item, Date.now()), { merge: true });
      return item;
    }

    async function deleteRowsByUid(uids) {
      const db = firebaseDatabase();
      const valid = [...(uids || [])].filter(Boolean);
      if (!db || !valid.length) return;
      const batch = db.batch();
      valid.forEach((uid) => batch.delete(db.collection(COLLECTION).doc(uid)));
      await batch.commit();
    }

    async function readIndexCache() {
      try {
        const raw = JSON.parse(localStorage.getItem(INDEX_CACHE_KEY) || 'null');
        const rows = (Array.isArray(raw?.data) ? raw.data : []).map(normalizeIndexItem).filter((item) => item.descripcion || item.idart);
        const enrichedRows = await enrichIndexProviders(rows);
        return enrichedRows;
      } catch (error) {
        console.warn(error);
        return [];
      }
    }

    async function enrichIndexProviders(rows) {
      try {
        let providers = await getProvidersCache();
        if (!providers.length) {
          try {
            providers = await importProvidersCloud();
          } catch (error) {
            console.warn(error);
            providers = [];
          }
        }
        if (!providers.length) return rows;
        const providerMap = new Map();
        for (const provider of providers) {
          const name = String(provider.proveedor || '').trim();
          for (const id of idVariants(provider.id_proveedor)) providerMap.set(id, name);
        }
        for (const row of rows) {
          if (row.idProveedor) {
            row.proveedor = idVariants(row.idProveedor).map((id) => providerMap.get(id)).find(Boolean) || row.proveedor || '';
            withSearch(row);
          }
        }
        return rows;
      } catch (error) {
        console.warn(error);
        return rows || [];
      }
    }

    async function readIndexRemote() {
      try {
        const db = firebaseDatabase();
        if (!db) return [];
        const snap = await db.collection('config').doc('listaActual').get();
        const url = snap.exists ? String(snap.data()?.url || '').trim() : '';
        if (!url) return [];
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        if (!Array.isArray(data) || !data.length) return [];
        localStorage.setItem(INDEX_CACHE_KEY, JSON.stringify({ url, savedAt: Date.now(), data }));
        return enrichIndexProviders(data.map(normalizeIndexItem).filter((item) => item.descripcion || item.idart));
      } catch (error) {
        console.warn(error);
        return [];
      }
    }

    async function readIndexRemoteIfChanged() {
      try {
        const db = firebaseDatabase();
        if (!db) return null;
        const snap = await db.collection('config').doc('listaActual').get();
        const url = snap.exists ? String(snap.data()?.url || '').trim() : '';
        if (!url) return null;
        const raw = JSON.parse(localStorage.getItem(INDEX_CACHE_KEY) || 'null');
        if (raw?.url === url && Array.isArray(raw?.data) && raw.data.length) return null;
        return readIndexRemote();
      } catch (error) {
        console.warn(error);
        return null;
      }
    }

    function openListDb() {
      return openDb(LIST_DB, (database, transaction) => {
        let store;
        if (!database.objectStoreNames.contains('articulos')) store = database.createObjectStore('articulos', { keyPath: 'idorden' });
        else store = transaction.objectStore('articulos');
        if (!store.indexNames.contains('id_proveedor')) store.createIndex('id_proveedor', 'id_proveedor', { unique: false });
        if (!store.indexNames.contains('proveedor')) store.createIndex('proveedor', 'proveedor', { unique: false });
        if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'id' });
      }, 4);
    }

    async function readProviderArticlesCache() {
      try {
        const database = await openListDb();
        return await new Promise((resolve, reject) => {
          const out = [];
          const request = database.transaction('articulos').objectStore('articulos').openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve(out);
              return;
            }
            const item = normalizeProviderArticle(cursor.value);
            if (item.descripcion || item.idart) out.push(item);
            cursor.continue();
          };
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.warn(error);
        return [];
      }
    }

    async function readProviderArticlesCacheByProvider(providerId = '', providerName = '') {
      try {
        const database = await openListDb();
        const id = cleanId(providerId);
        const name = String(providerName || '').trim();
        const rawItems = await new Promise((resolve, reject) => {
          const tx = database.transaction('articulos', 'readonly');
          const store = tx.objectStore('articulos');
          if (id && store.indexNames.contains('id_proveedor')) {
            const request = store.index('id_proveedor').getAll(id);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
            return;
          }
          if (name && store.indexNames.contains('proveedor')) {
            const request = store.index('proveedor').getAll(name);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
            return;
          }
          resolve([]);
        });
        return sortCatalogByDescription(rawItems.map(normalizeProviderArticle).filter((item) => item.descripcion || item.idart));
      } catch (error) {
        console.warn(error);
        return [];
      }
    }

    async function remoteProviderListMeta() {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.priceListMeta}?id=eq.principal&select=lista_version,total_articulos,archivo_nombre,updated_at&limit=1`, {
        headers: headers()
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json())?.[0] || null;
    }

    function localProviderListMeta() {
      try {
        return JSON.parse(localStorage.getItem(PROVIDER_LIST_META_KEY) || 'null');
      } catch {
        return null;
      }
    }

    function setLocalProviderListMeta(meta) {
      if (meta) localStorage.setItem(PROVIDER_LIST_META_KEY, JSON.stringify({ id: 'principal', ...meta }));
    }

    function timestampValue(value) {
      if (!value) return 0;
      const text = String(value).trim();
      const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text) ? text.replace(' ', 'T') : text;
      const date = new Date(normalized);
      if (!Number.isNaN(date.getTime())) return date.getTime();
      const day = new Date(text.slice(0, 10));
      return Number.isNaN(day.getTime()) ? 0 : day.getTime();
    }

    async function providerCacheHasRows() {
      try {
        const database = await openListDb();
        return await new Promise((resolve, reject) => {
          const request = database.transaction('articulos').objectStore('articulos').count();
          request.onsuccess = () => resolve(request.result > 0);
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.warn(error);
        return false;
      }
    }

    async function replaceProviderArticlesCache(rows, meta) {
      const database = await openListDb();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('articulos', 'readwrite');
        const store = tx.objectStore('articulos');
        store.clear();
        rows.forEach((row) => store.put(row));
        tx.oncomplete = () => {
          setLocalProviderListMeta({ ...meta, last_provider_sync_at: new Date().toISOString(), last_provider_sync_date: today() });
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    }

    async function replaceProviderArticlesCacheBlock(providerId, rows) {
      const database = await openListDb();
      return new Promise((resolve, reject) => {
        const id = String(providerId || '');
        const tx = database.transaction('articulos', 'readwrite');
        const store = tx.objectStore('articulos');
        const source = store.indexNames.contains('id_proveedor')
          ? store.index('id_proveedor')
          : store;
        const request = source.openCursor(store.indexNames.contains('id_proveedor') ? IDBKeyRange.only(id) : null);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (source !== store || String(cursor.value?.id_proveedor || '') === id) cursor.delete();
            cursor.continue();
            return;
          }
          rows.forEach((row) => store.put(row));
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function fetchProvidersUpdatedAfter(lastSyncAt) {
      const providers = await fetchAll(TABLES.providers, 'select=id_proveedor,proveedor,ultima_actualizacion,updated_at&order=updated_at.asc');
      const lastValue = timestampValue(lastSyncAt);
      return (providers || []).filter((provider) => {
        const providerValue = timestampValue(provider.updated_at || provider.ultima_actualizacion);
        return provider.id_proveedor && providerValue && (!lastValue || providerValue > lastValue);
      });
    }

    async function fetchProviderArticles(providerId) {
      return fetchAll(
        TABLES.priceList,
        `select=idorden,cod_proveedor,articulo,precio_costo,id_proveedor,proveedor,cod_proveedor_norm,articulo_norm,proveedor_norm&id_proveedor=eq.${encodeURIComponent(providerId)}&order=idorden.asc`
      );
    }

    async function fetchProviderJsonManifest(meta) {
      const tableManifest = await fetchProviderJsonTableManifest().catch((error) => {
        console.warn(error);
        return null;
      });
      if (tableManifest && Object.keys(tableManifest.providers || {}).length) return tableManifest;
      const url = manifestUrlFromMetaValue(meta?.archivo_nombre);
      if (!url) return null;
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
      if (!response.ok) throw new Error(await response.text());
      const manifest = await response.json();
      return {
        id: 'provider-json-manifest-v1',
        version: Number(manifest?.version || 0),
        updated_at: manifest?.updated_at || '',
        providers: manifest?.providers && typeof manifest.providers === 'object' ? manifest.providers : {}
      };
    }

    function localProviderJsonManifest(meta) {
      return meta?.provider_json_manifest && typeof meta.provider_json_manifest === 'object'
        ? meta.provider_json_manifest
        : {};
    }

    function providerJsonManifestEntries(manifest) {
      return Object.values(manifest?.providers || {}).filter((entry) => entry?.id_proveedor && providerJsonUrls(entry).length);
    }
    function findProviderJsonEntry(manifest, provider = '', providerId = '') {
      const id = cleanId(providerId || String(provider || '').match(/^\s*([0-9.]+)\s*[-–]/)?.[1] || '');
      const name = norm(String(provider || '').replace(/^\s*\d+\s*[-–]\s*/, ''));
      const entries = providerJsonManifestEntries(manifest);
      if (id) {
        const byId = entries.find((entry) => cleanId(entry.id_proveedor) === id);
        if (byId) return byId;
      }
      if (name) {
        return entries.find((entry) => norm(entry.proveedor) === name) || entries.find((entry) => norm(entry.proveedor).includes(name) || name.includes(norm(entry.proveedor)));
      }
      return null;
    }

    function providerJsonUrls(entry) {
      const chunks = Array.isArray(entry?.chunks) ? entry.chunks.map((chunk) => String(chunk?.json_url || '').trim()).filter(Boolean) : [];
      return chunks.length ? chunks : [String(entry?.json_url || '').trim()].filter(Boolean);
    }

    function needsProviderJsonSync(entry, localManifest) {
      const id = cleanId(entry.id_proveedor);
      const local = localManifest[id];
      if (!local) return true;
      if (providerJsonUrls(local).join('|') !== providerJsonUrls(entry).join('|')) return true;
      return Number(local.version || 0) < Number(entry.version || 0);
    }

    function normalizeProviderJsonCacheRow(row, entry, index) {
      const id = cleanId(row?.id_proveedor || row?.idProveedor || entry?.id_proveedor || '');
      const providerName = String(row?.proveedor || entry?.proveedor || '').trim();
      const cod = String(row?.cod_proveedor || row?.codProv || row?.codprov || '').trim();
      const article = String(row?.articulo || row?.descripcion || row?.nombre || '').trim();
      return {
        idorden: Number(row?.idorden || 0) || Number(entry?.version || Date.now()) * 1000 + index,
        cod_proveedor: cod,
        articulo: article,
        precio_costo: Number(row?.precio_costo ?? row?.precioCosto ?? row?.precio ?? 0) || 0,
        id_proveedor: id,
        proveedor: providerName,
        cod_proveedor_norm: norm(row?.cod_proveedor_norm || cod),
        articulo_norm: norm(row?.articulo_norm || article),
        proveedor_norm: norm(row?.proveedor_norm || providerName),
        articulo_source: row?.articulo_source || 'provider_json'
      };
    }

    async function fetchProviderJsonRows(entry) {
      const urls = providerJsonUrls(entry);
      const out = [];
      for (const url of urls) {
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(entry.version || '')}`);
        if (!response.ok) throw new Error(await response.text());
        const rows = await response.json();
        if (Array.isArray(rows)) {
          const offset = out.length;
          out.push(...rows.map((row, index) => normalizeProviderJsonCacheRow(row, entry, offset + index)).filter((row) => row.articulo || row.cod_proveedor));
        }
      }
      return out;
    }

    async function downloadProviderArticlesCloud(meta) {
      const rows = await fetchAll(TABLES.priceList, `select=idorden,cod_proveedor,articulo,precio_costo,id_proveedor,proveedor,cod_proveedor_norm,articulo_norm,proveedor_norm&order=idorden.asc`);
      await replaceProviderArticlesCache(rows, meta);
      return sortCatalogByDescription(rows.map(normalizeProviderArticle).filter((item) => item.descripcion || item.idart));
    }

    async function syncProviderJsonBlocks(meta, options = {}) {
      const manifest = await fetchProviderJsonManifest(meta).catch((error) => {
        console.warn(error);
        return null;
      });
      if (!manifest) return null;
      const local = localProviderListMeta() || {};
      const localManifest = localProviderJsonManifest(local);
      const entries = providerJsonManifestEntries(manifest);
      const changed = options.forceAll ? entries : entries.filter((entry) => needsProviderJsonSync(entry, localManifest));
      if (!changed.length) {
        if (options.updateWhenNoChanges !== false) {
          setLocalProviderListMeta({
            ...local,
            ...meta,
            provider_json_manifest: manifest.providers,
            last_provider_sync_at: new Date().toISOString(),
            last_provider_sync_date: today()
          });
        }
        return false;
      }
      const nextLocalManifest = options.forceAll ? {} : { ...localManifest };
      if (options.clearBeforeImport) {
        const database = await openListDb();
        await new Promise((resolve, reject) => {
          const request = database.transaction('articulos', 'readwrite').objectStore('articulos').clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
      for (const entry of changed) {
        const deletePromise = options.clearBeforeImport ? Promise.resolve() : replaceProviderArticlesCacheBlock(entry.id_proveedor, []);
        const rows = await fetchProviderJsonRows(entry);
        await deletePromise;
        await replaceProviderArticlesCacheBlock(entry.id_proveedor, rows);
        nextLocalManifest[cleanId(entry.id_proveedor)] = {
          id_proveedor: cleanId(entry.id_proveedor),
          proveedor: entry.proveedor || '',
          version: Number(entry.version || 0),
          updated_at: entry.updated_at || '',
          total_articulos: Number(entry.total_articulos || rows.length),
          json_url: entry.json_url,
          chunk_count: Number(entry.chunk_count || providerJsonUrls(entry).length || 1),
          chunks: Array.isArray(entry.chunks) ? entry.chunks : null
        };
      }
      setLocalProviderListMeta({
        ...local,
        ...meta,
        provider_json_manifest: nextLocalManifest,
        last_provider_sync_at: new Date().toISOString(),
        last_provider_sync_date: today()
      });
      return sortCatalogByDescription(await readProviderArticlesCache());
    }

    async function syncSingleProviderJson(provider = '', providerId = '') {
      const meta = await remoteProviderListMeta();
      if (!meta) return [];
      const manifest = await fetchProviderJsonManifest(meta);
      if (!manifest) return [];
      const entry = findProviderJsonEntry(manifest, provider, providerId);
      if (!entry) return [];
      const local = localProviderListMeta() || {};
      const localManifest = localProviderJsonManifest(local);
      if (!needsProviderJsonSync(entry, localManifest)) {
        const cached = await readProviderArticlesCacheByProvider(entry.id_proveedor, entry.proveedor);
        if (cached.length) return cached;
      }
      const rows = await fetchProviderJsonRows(entry);
      await replaceProviderArticlesCacheBlock(entry.id_proveedor, rows);
      setLocalProviderListMeta({
        ...local,
        ...meta,
        provider_json_manifest: {
          ...localManifest,
          [cleanId(entry.id_proveedor)]: {
            id_proveedor: cleanId(entry.id_proveedor),
            proveedor: entry.proveedor || '',
            version: Number(entry.version || 0),
            updated_at: entry.updated_at || '',
            total_articulos: Number(entry.total_articulos || rows.length),
            json_url: entry.json_url,
            chunk_count: Number(entry.chunk_count || providerJsonUrls(entry).length || 1),
            chunks: Array.isArray(entry.chunks) ? entry.chunks : null
          }
        },
        last_provider_sync_at: new Date().toISOString(),
        last_provider_sync_date: today()
      });
      return rows.map(normalizeProviderArticle).filter((item) => item.descripcion || item.idart);
    }

    async function syncProviderArticleBlocks(meta) {
      const local = localProviderListMeta() || {};
      const lastSyncAt = local.last_provider_sync_at || local.updated_at || local.last_provider_sync_date || '';
      if (!lastSyncAt) return downloadProviderArticlesCloud(meta);
      const changedProviders = await fetchProvidersUpdatedAfter(lastSyncAt);
      if (!changedProviders.length) {
        setLocalProviderListMeta({ ...local, ...meta, last_provider_sync_at: new Date().toISOString(), last_provider_sync_date: today() });
        return null;
      }
      for (const provider of changedProviders) {
        const rows = await fetchProviderArticles(provider.id_proveedor);
        await replaceProviderArticlesCacheBlock(provider.id_proveedor, rows);
      }
      setLocalProviderListMeta({ ...local, ...meta, last_provider_sync_at: new Date().toISOString(), last_provider_sync_date: today() });
      return sortCatalogByDescription(await readProviderArticlesCache());
    }

    async function readProviderArticlesRemoteIfChanged() {
      try {
        const meta = await remoteProviderListMeta();
        if (!meta) return null;
        const local = localProviderListMeta();
        const hasCachedRows = await providerCacheHasRows();
        const metaVersionMatches = local && Number(local.lista_version) === Number(meta.lista_version);
        if (metaVersionMatches && hasCachedRows) return null;
        if (local && hasCachedRows) {
          const jsonResult = await syncProviderJsonBlocks(meta, { updateWhenNoChanges: Boolean(metaVersionMatches) });
          if (jsonResult) return jsonResult;
          if (jsonResult === false && manifestUrlFromMetaValue(meta.archivo_nombre)) return null;
          if (jsonResult === false && metaVersionMatches) return null;
          return syncProviderArticleBlocks(meta);
        }
        if (manifestUrlFromMetaValue(meta.archivo_nombre)) return null;
        const jsonResult = await syncProviderJsonBlocks(meta);
        if (jsonResult) return jsonResult;
        return downloadProviderArticlesCloud(meta);
      } catch (error) {
        console.warn(error);
        return null;
      }
    }

    async function loadProviderNames() {
      let providers = [];
      try {
        providers = await importProvidersCloud();
      } catch (error) {
        console.warn(error);
        providers = await getProvidersCache();
      }
      return providers
        .map((provider) => ({ ...provider, idNorm: norm(provider.id_proveedor), nameNorm: norm(provider.proveedor) }))
        .sort((a, b) => String(a.proveedor || '').localeCompare(String(b.proveedor || ''), 'es', { numeric: true, sensitivity: 'base' }));
    }

    function catalogSource(useProviderList = false) {
      return useProviderList ? 'proveedores' : 'corralon';
    }

    function catalogSourceLabel(useProviderList = false) {
      return useProviderList ? 'listas de proveedores' : 'lista de corralon';
    }

    function resetCatalogToggle(checkbox) {
      if (checkbox) checkbox.checked = false;
    }

    function bindCatalogToggle(checkbox, onChange) {
      resetCatalogToggle(checkbox);
      if (!checkbox) return;
      checkbox.addEventListener('change', () => onChange(Boolean(checkbox.checked)));
    }

    function sortCatalogByDescription(rows = []) {
      return rows.sort((a, b) => String(a.descripcion || '').localeCompare(String(b.descripcion || ''), 'es', { numeric: true, sensitivity: 'base' }));
    }

    async function loadCorralonCatalog(cache = {}, force = false) {
      if (!cache.index || force) {
        const sharedRows = await CATALOG.load({ force, fallback: true });
        if (sharedRows.length) {
          cache.index = await enrichIndexProviders(sharedRows.map(normalizeIndexItem).filter((item) => item.descripcion || item.idart));
          sortCatalogByDescription(cache.index);
          return cache.index;
        }
        const localRows = await readIndexCache();
        const needsRemote = force || !localRows.length || localRows.some((row) => row.idProveedor && !row.proveedor);
        const remoteRows = needsRemote ? await readIndexRemote() : [];
        cache.index = remoteRows.length ? remoteRows : localRows;
        if (!cache.index.length) cache.index = localRows;
        sortCatalogByDescription(cache.index);
      }
      return cache.index;
    }

    async function loadProviderCatalog(cache = {}, force = false) {
      if (!cache.proveedores || force) cache.proveedores = sortCatalogByDescription(await readProviderArticlesCache());
      return cache.proveedores;
    }

    async function loadProviderCatalogWithProgress(cache, onProgress) {
      if (typeof onProgress === 'function') onProgress(2);
      const result = [];
      try {
        const database = await openListDb();
        const total = await new Promise((resolve, reject) => {
          const request = database.transaction('articulos').objectStore('articulos').count();
          request.onsuccess = () => resolve(Number(request.result || 0));
          request.onerror = () => reject(request.error);
        });
        if (!total) {
          cache.proveedores = cache.proveedores || [];
          if (typeof onProgress === 'function') onProgress(100);
          return cache.proveedores;
        }
        if (typeof onProgress === 'function') onProgress(8);
        await new Promise((resolve, reject) => {
          const store = database.transaction('articulos', 'readonly').objectStore('articulos');
          const request = store.openCursor();
          let read = 0;
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve();
              return;
            }
            const item = normalizeProviderArticle(cursor.value);
            if (item.descripcion || item.idart) result.push(item);
            read++;
            if (read % 1500 === 0) {
              if (typeof onProgress === 'function') onProgress(8 + Math.round((read / total) * 88));
            }
            cursor.continue();
          };
        });
      } catch (error) {
        console.warn(error);
        if (!cache.proveedores) cache.proveedores = [];
        if (typeof onProgress === 'function') onProgress(100);
        return cache.proveedores;
      }
      cache.proveedores = result;
      if (typeof onProgress === 'function') onProgress(100);
      return result;
    }

    async function loadCatalog(useProviderList = false, cache = {}, force = false) {
      if (useProviderList) await loadProviderCatalog(cache, force);
      else await loadCorralonCatalog(cache, force);
      const catalog = useProviderList ? cache.proveedores : cache.index;
      const byIdart = new Map();
      for (const row of catalog) {
        const digits = String(row.idart || '').replace(/\D/g, '').padStart(6, '0');
        if (digits && !byIdart.has(digits)) byIdart.set(digits, row);
      }
      return { catalog, byIdart, cache };
    }

    async function syncCatalogInBackground(useProviderList = false, cache = {}, onUpdated = null) {
      try {
        const updated = useProviderList
          ? await readProviderArticlesRemoteIfChanged()
          : await CATALOG.load({ force: true, fallback: true });
        if (!updated?.length) return false;
        if (useProviderList) cache.proveedores = sortCatalogByDescription(updated);
        else cache.index = sortCatalogByDescription(
          await enrichIndexProviders(updated.map(normalizeIndexItem).filter((item) => item.descripcion || item.idart))
        );
        if (typeof onUpdated === 'function') onUpdated(useProviderList ? cache.proveedores : cache.index, cache);
        return true;
      } catch (error) {
        console.warn(error);
        return false;
      }
    }

    function catalogFilter({ code = '', article = '', extra = '', columnFiltro = '', provider = '', providerId = '' } = {}) {
      return {
        code: searchNorm(code),
        articleWords: searchNorm(`${article} ${columnFiltro} ${extra}`).split(' ').filter(Boolean),
        provider: searchNorm(provider),
        providerId: cleanId(providerId)
      };
    }

    function catalogMatches(row, filter) {
      const providerIdMatch = !filter.providerId || idVariants(filter.providerId).some((id) => idVariants(row.idProveedor).includes(id));
      const providerTextMatch = filter.providerId || !filter.provider || row.proveedorNorm.includes(filter.provider);
      const exactCodeMatch = filter.code && (row.codProvNorm === filter.code || row.idartNorm === filter.code);
      if (exactCodeMatch) return providerIdMatch && providerTextMatch;
      return (!filter.code || row.codProvNorm.includes(filter.code) || row.idartNorm.includes(filter.code)) &&
        providerIdMatch &&
        providerTextMatch &&
        (!filter.articleWords.length || filter.articleWords.every((word) => row.descripcionNorm.includes(word)));
    }

    function catalogOptions(catalog, filter, limit = 100) {
      const out = [];
      for (let i = 0; i < (catalog || []).length && out.length < limit; i++) {
        if (catalogMatches(catalog[i], filter)) out.push(catalog[i]);
      }
      return out;
    }

    function providerOptions(providers, text = '', limit = 100) {
      const query = norm(text);
      const out = [];
      for (let i = 0; i < providers.length && out.length < limit; i++) {
        const row = providers[i];
        if (!query || row.nameNorm.includes(query) || row.idNorm.includes(query)) out.push(row);
      }
      return out;
    }

    function applyArticle(row, item, columnFiltro = '') {
      if (!row || !item) return false;
      const precioCosto = Number(item.precioCosto || 0);
      Object.assign(row, {
        idart: item.idart,
        idProveedor: item.idProveedor || '',
        codProv: item.codProv,
        filtro: columnFiltro,
        proveedor: item.proveedor || '',
        descripcion: item.descripcion,
        precioCosto,
        precioFinal: item.source === 'index' ? precioCosto : Number(item.precioFinal || precioCosto),
        source: item.source
      });
      return true;
    }

    function applyIdart(row, byIdart, columnFiltro = '') {
      if (!row?.idart) return false;
      const padded = String(row.idart).replace(/\D/g, '').padStart(6, '0');
      row.idart = padded;
      return applyArticle(row, byIdart.get(padded), columnFiltro);
    }

    function sortRows(rows, sortState) {
      const sortValue = (row, col) => {
        if (col === 'id') return Number(row.id || Number.MAX_SAFE_INTEGER);
        if (col === 'cantidad' || col === 'precioCosto' || col === 'precioFinal') return Number(row[col] || 0);
        if (col === 'pedido') return row.pedido ? 1 : 0;
        return norm(row[col] || '');
      };
      const blank = rows.filter(isBlank);
      const filled = rows.filter((row) => !isBlank(row));
      filled.sort((a, b) => {
        const av = sortValue(a, sortState.col);
        const bv = sortValue(b, sortState.col);
        if (typeof av === 'number' || typeof bv === 'number') return ((Number(av) || 0) - (Number(bv) || 0)) * sortState.dir;
        return String(av).localeCompare(String(bv), 'es', { numeric: true, sensitivity: 'base' }) * sortState.dir;
      });
      return [...filled, ...blank.slice(-1)];
    }

    return {
      LOCAL_KEY,
      COLLECTION,
      searchNorm,
      makeLocalUid,
      blankRow,
      isBlank,
      loadLocalRows,
      saveLocalRows,
      loadColumnFiltro,
      loadRemoteRows,
      subscribeRows,
      saveRows,
      addRow,
      deleteRowsByUid,
      loadProviderNames,
      catalogSource,
      catalogSourceLabel,
      resetCatalogToggle,
      bindCatalogToggle,
      loadCorralonCatalog,
      loadProviderCatalog,
      loadProviderCatalogWithProgress,
      syncSingleProviderJson,
      loadCatalog,
      syncCatalogInBackground,
      catalogFilter,
      catalogOptions,
      providerOptions,
      applyArticle,
      applyIdart,
      sortRows
    };
  })();

  window.CorralonSystem = {
    SUPABASE_URL,
    SUPABASE_KEY,
    TABLES,
    BRANCHES,
    PROVIDER_MANIFEST_PREFIX,
    headers,
    norm,
    parseMoney,
    parseFlexibleNumber,
    dateOnly,
    today,
    nowTimestamp,
    money,
    percent,
    normalizeBranch,
    branchIdFromIdsuc,
    resolveBranchStocks,
    mergeArticleBranchStocks,
    providerFromObject,
    normalizeProviderPageLink,
    providerRemotePayload,
    getProvidersCache,
    setProvidersCache,
    putProviderCacheItem,
    importProvidersCloud,
    uploadProviders,
    updateProviderDateOnly,
    touchPriceListMeta,
    loadProviderJsonManifest,
    fetchProviderJsonTableRows,
    fetchProviderJsonTableManifest,
    upsertProviderJsonTableEntry,
    publishProviderArticlesJson,
    replaceProviderArticles,
    buildArticlesXlsBlob,
    saveBlobAs,
    buildImageGeneratorPayload,
    setImageGeneratorCatalog,
    getImageGeneratorCatalog,
    setImageGeneratorPayload,
    readImageGeneratorPayload,
    openImageGenerator,
    articleEditor: {
      configure: configureArticleEditor,
      open: openArticleEditor,
      close: closeArticleEditor,
      publishCatalog: publishArticleCatalog
    },
    catalog: CATALOG,
    faltantes: FALTANTES
  };
})();
