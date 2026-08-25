(function () {
  try {
  const SUPABASE_URL = 'https://tizyjenayrcdkcodsjnc.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpenlqZW5heXJjZGtjb2Rzam5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzE4MDYsImV4cCI6MjA4NzgwNzgwNn0.Xue8zgo8QJiKTErtzfUOgpczMngsAaePJZqLvA8Z7oI';
  const TABLES = {
    providers: 'proveedores',
    providersMeta: 'proveedores_meta',
    priceList: 'lista_precios',
    priceListMeta: 'lista_precios_meta',
    priceListJsonProviders: 'listas_json_proveedores',
    catalog: 'catalogo_articulos',
    catalogMeta: 'catalogo_articulos_meta',
    catalogChanges: 'catalogo_articulos_cambios',
    catalogPublic: 'catalogo_articulos_publico',
    catalogEdits: 'catalogo_articulos_edicion'
  };
  const PROVIDERS_DB = 'proveedores_cache_v1';
  const CLOUDINARY_RAW_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/do0i2da7h/raw/upload';
  const CLOUDINARY_UPLOAD_PRESET = 'Corralon';
  const PROVIDER_MANIFEST_PREFIX = 'provider_manifest:';
  const FULL_PROVIDER_MANIFEST_PREFIX = 'provider_full_manifest:';
  const CLOUDINARY_JSON_MAX_BYTES = 8 * 1024 * 1024;
  const IS_AUTOMATED_CRAWLER = /(?:bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|linkedinbot|twitterbot)/i
    .test(String(globalThis.navigator?.userAgent || ''));
  const IMAGE_GENERATOR_CATALOG_KEY = 'corralon_image_generator_catalog_v1';
  const IMAGE_GENERATOR_PAYLOAD_KEY = 'corralon_image_generator_payload_v1';
  const LARGE_CACHE_DB = 'corralon_cache_grande_v1';
  let imageGeneratorCatalogMemory = null;
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
  const ARTICLE_EDITOR_LABEL_KEYS = ['oferta', 'destacado', 'masVendido', 'accesoRapido', 'ceramico'];
  let articleEditorApplyLabels = new Set(ARTICLE_EDITOR_LABEL_KEYS);
  let articleEditorFunctionsBound = false;
  let articleEditorBasePrice = 0;
  let articleEditorTargetRubroOpen = false;
  let articleEditorTargetRubroIndex = -1;
  let articleSyncIndicatorHideTimer = null;
  const ARID_PRICE_TIERS = [
    { key: 'm1', meters: 1, label: '1 m³' },
    { key: 'm1_5', meters: 1.5, label: '1,5 m³' },
    { key: 'm2', meters: 2, label: '2 m³' },
    { key: 'm2_5', meters: 2.5, label: '2,5 m³' },
    { key: 'm3', meters: 3, label: '3 m³' },
    { key: 'm3_5', meters: 3.5, label: '3,5 m³' },
    { key: 'm4', meters: 4, label: '4 m³' },
    { key: 'm4_5', meters: 4.5, label: '4,5 m³' },
    { key: 'm5', meters: 5, label: '5 m³' }
  ];
  const ARIDOS_GALDEANO_PROVIDER_IDS = new Set(['6072']);
  let aridosAdapter = {};
  let aridosConfigMap = new Map();
  let aridosFreightConfig = {
    idArtFlete: '012025',
    rawson: 0,
    pasandoCalle5: 0
  };
  let articleEditorAridEligible = false;
  let aridosBudgetHost = null;
  let aridosBudgetArticleCode = '';
  let aridosBudgetReturnFocus = null;
  let aridosBudgetItems = [];
  let aridosBudgetFreightMode = 'none';
  let aridosBudgetCustomRate = 0;
  const ARID_COST_VAT_FACTOR = 1.21;

  function ensureArticleSyncIndicator() {
    let indicator = document.getElementById('corralonArticleSyncIndicator');
    if (indicator) return indicator;
    const style = document.createElement('style');
    style.id = 'corralonArticleSyncIndicatorStyle';
    style.textContent = `
      #corralonArticleSyncIndicator {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        width: min(330px, calc(100vw - 40px));
        padding: 12px 14px 13px;
        border: 1px solid #c9c9c9;
        border-radius: 13px;
        background: rgba(255,255,255,.98);
        color: #171717;
        box-shadow: 0 12px 32px rgba(0,0,0,.22);
        font: 700 13px/1.25 Arial, sans-serif;
        opacity: 0;
        visibility: hidden;
        transform: translateY(12px);
        transition: opacity .18s ease, transform .18s ease, visibility .18s ease;
        pointer-events: none;
      }
      #corralonArticleSyncIndicator.is-visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      #corralonArticleSyncIndicator .corralon-sync-copy {
        display: flex;
        align-items: center;
        gap: 9px;
        margin-bottom: 9px;
      }
      #corralonArticleSyncIndicator .corralon-sync-dot {
        width: 9px;
        height: 9px;
        flex: 0 0 9px;
        border-radius: 50%;
        background: #f20d18;
        box-shadow: 0 0 0 4px rgba(242,13,24,.12);
      }
      #corralonArticleSyncIndicator .corralon-sync-track {
        height: 5px;
        overflow: hidden;
        border-radius: 999px;
        background: #e4e4e4;
      }
      #corralonArticleSyncIndicator .corralon-sync-fill {
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: #f20d18;
        transform: translateX(-120%);
      }
      #corralonArticleSyncIndicator.is-syncing .corralon-sync-fill {
        animation: corralonArticleSyncProgress 1.05s ease-in-out infinite;
      }
      #corralonArticleSyncIndicator.is-success .corralon-sync-dot,
      #corralonArticleSyncIndicator.is-success .corralon-sync-fill {
        background: #159447;
      }
      #corralonArticleSyncIndicator.is-success .corralon-sync-dot {
        box-shadow: 0 0 0 4px rgba(21,148,71,.12);
      }
      #corralonArticleSyncIndicator.is-success .corralon-sync-fill {
        width: 100%;
        transform: translateX(0);
      }
      #corralonArticleSyncIndicator.is-error .corralon-sync-fill {
        width: 100%;
        transform: translateX(0);
      }
      @keyframes corralonArticleSyncProgress {
        0% { transform: translateX(-120%); }
        55% { transform: translateX(105%); }
        100% { transform: translateX(245%); }
      }
    `;
    document.head.appendChild(style);
    indicator = document.createElement('div');
    indicator.id = 'corralonArticleSyncIndicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.innerHTML = `
      <div class="corralon-sync-copy">
        <span class="corralon-sync-dot"></span>
        <span data-corralon-sync-text>Sincronizando en segundo plano…</span>
      </div>
      <div class="corralon-sync-track"><div class="corralon-sync-fill"></div></div>
    `;
    document.body.appendChild(indicator);
    return indicator;
  }

  function setArticleSyncIndicator(state, message) {
    const indicator = ensureArticleSyncIndicator();
    const text = indicator.querySelector('[data-corralon-sync-text]');
    clearTimeout(articleSyncIndicatorHideTimer);
    indicator.classList.remove('is-syncing', 'is-success', 'is-error');
    indicator.classList.add('is-visible', `is-${state}`);
    if (text) text.textContent = message;
    if (state === 'success' || state === 'error') {
      articleSyncIndicatorHideTimer = setTimeout(() => {
        indicator.classList.remove('is-visible');
      }, state === 'success' ? 1700 : 5000);
    }
  }

  window.addEventListener('corralon:article-sync-start', () => {
    setArticleSyncIndicator('syncing', 'Sincronizando en segundo plano…');
  });
  window.addEventListener('corralon:article-sync-success', () => {
    setArticleSyncIndicator('success', 'Cambios sincronizados');
  });
  window.addEventListener('corralon:article-sync-error', () => {
    setArticleSyncIndicator('error', 'No se pudo sincronizar. Los cambios siguen visibles localmente.');
  });

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

  function aridCodeKey(value) {
    return String(value ?? '').trim().toUpperCase();
  }

  function normalizeAridPrices(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(ARID_PRICE_TIERS.map((tier) => [
      tier.key,
      Math.max(0, Number(parseFlexibleNumber(source[tier.key] ?? source[String(tier.meters)] ?? 0) || 0))
    ]));
  }

  function normalizeAridConfig(value = {}, code = '') {
    const source = value && typeof value === 'object' ? value : {};
    return {
      codigo: String(source.codigo ?? code ?? '').trim(),
      activo: articleBool(source.activo ?? source.arido),
      precios: normalizeAridPrices(source.precios ?? source.aridoPrecios ?? source.preciosArido ?? {})
    };
  }

  function normalizeAridFreightConfig(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      idArtFlete: String(source.idArtFlete ?? source.id_art_flete ?? '012025').trim() || '012025',
      rawson: Math.max(0, Number(parseFlexibleNumber(source.rawson ?? source.fleteRawson ?? 0) || 0)),
      pasandoCalle5: Math.max(0, Number(parseFlexibleNumber(source.pasandoCalle5 ?? source.pasando_calle_5 ?? source.fleteCalle5 ?? 0) || 0))
    };
  }

  function configureAridos(options = {}) {
    aridosAdapter = { ...aridosAdapter, ...options };
  }

  function setAridosConfigMap(source) {
    const next = new Map();
    const add = (key, value) => {
      const normalized = normalizeAridConfig(value, key);
      const mapKey = aridCodeKey(normalized.codigo || key);
      if (mapKey) next.set(mapKey, normalized);
    };
    if (source instanceof Map) source.forEach((value, key) => add(key, value));
    else if (Array.isArray(source)) source.forEach((value) => add(value?.codigo, value));
    else if (source && typeof source === 'object') Object.entries(source).forEach(([key, value]) => add(key, value));
    aridosConfigMap = next;
    window.dispatchEvent(new CustomEvent('corralon:aridos-config-loaded', { detail: { configs: next } }));
    return next;
  }

  function setAridosFreightConfig(value) {
    aridosFreightConfig = normalizeAridFreightConfig(value);
    window.dispatchEvent(new CustomEvent('corralon:aridos-freight-loaded', { detail: { ...aridosFreightConfig } }));
    return { ...aridosFreightConfig };
  }

  function aridConfigForArticle(articleOrCode) {
    const code = typeof articleOrCode === 'object' ? articleCode(articleOrCode) : articleOrCode;
    const stored = aridosConfigMap.get(aridCodeKey(code));
    if (stored) return normalizeAridConfig(stored, code);
    if (articleOrCode && typeof articleOrCode === 'object') {
      return normalizeAridConfig({
        codigo: code,
        activo: articleOrCode.arido,
        precios: articleOrCode.aridoPrecios ?? articleOrCode.preciosArido
      }, code);
    }
    return normalizeAridConfig({}, code);
  }

  function decorateAridArticle(article = {}) {
    const config = aridConfigForArticle(article);
    return {
      ...article,
      arido: config.activo,
      aridoPrecios: { ...config.precios },
      preciosArido: { ...config.precios }
    };
  }

  function looksLikeAridosGaldeano(value) {
    const text = norm(value);
    return text.includes('aridos') && text.includes('galdeano');
  }

  function articleProviderId(article = {}) {
    return String(
      article.idProveedor ?? article.id_proveedor ?? article.idprov ??
      article.proveedorId ?? article.proveedor_id ?? ''
    ).trim();
  }

  function directArticleProviderText(article = {}) {
    return [
      article.proveedor,
      article.nombreProveedor,
      article.nombre_proveedor,
      article.razonSocialProveedor,
      article.razon_social_proveedor
    ].filter(Boolean).join(' ');
  }

  async function resolveAridEligibility(article = {}) {
    const code = aridCodeKey(articleCode(article));
    if (code === aridCodeKey(aridosFreightConfig.idArtFlete || '012025')) return false;
    const wantedId = articleProviderId(article).replace(/^0+(?=\d)/, '');
    if (
      aridConfigForArticle(article).activo ||
      looksLikeAridosGaldeano(directArticleProviderText(article)) ||
      ARIDOS_GALDEANO_PROVIDER_IDS.has(wantedId)
    ) return true;
    if (typeof aridosAdapter.isEligible === 'function') {
      const resolved = await aridosAdapter.isEligible(article);
      if (typeof resolved === 'boolean') return resolved;
    }
    if (!wantedId) return false;
    let providers = typeof aridosAdapter.getProviders === 'function'
      ? await aridosAdapter.getProviders()
      : getProvidersCache();
    if (!providers || (Array.isArray(providers) && !providers.length) || (!Array.isArray(providers) && !Object.keys(providers).length)) {
      try {
        providers = await importProvidersCloud();
      } catch (_) {
        providers = providers || {};
      }
    }
    const list = Array.isArray(providers) ? providers : Object.values(providers || {});
    return list.some((provider) => {
      const normalized = providerFromObject(provider || {});
      const providerId = String(normalized.id ?? provider?.id ?? provider?.idProveedor ?? provider?.id_proveedor ?? '').trim();
      const providerName = normalized.nombre ?? provider?.nombre ?? provider?.razonSocial ?? provider?.razon_social ?? '';
      return providerId.replace(/^0+(?=\d)/, '') === wantedId && looksLikeAridosGaldeano(providerName);
    });
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
    const arid = articleEditorHost?.querySelector('[data-editor-extra="arido"]');
    if (offer) offer.hidden = !articleEditorHost.querySelector('[data-editor-chip="oferta"]')?.classList.contains('is-active');
    if (ceramic) ceramic.hidden = !articleEditorHost.querySelector('[data-editor-chip="ceramico"]')?.classList.contains('is-active');
    if (arid) arid.hidden = !articleEditorHost.querySelector('[data-editor-chip="arido"]')?.classList.contains('is-active');
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
      selector: '.corralon-article-editor-card [data-editor-field],.corralon-article-editor-card [data-editor-chip],.corralon-article-editor-card [data-editor-images-open],.corralon-article-editor-card [data-editor-apply-open],.corralon-article-editor-card [data-editor-save],[data-editor-target-search],[data-editor-target-rubro],[data-editor-target-code],[data-editor-apply-field],[data-editor-apply-label],[data-editor-apply-confirm]',
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
    const query = String(articleEditorHost.querySelector('[data-editor-target-search]')?.value || '').trim();
    const rubro = String(articleEditorHost.querySelector('[data-editor-target-rubro]')?.value || '').trim();
    const list = articleEditorAdapter.getArticles?.() || [];
    const targetList = articleEditorHost.querySelector('[data-editor-target-list]');
    const searched = typeof articleEditorAdapter.searchArticles === 'function'
      ? articleEditorAdapter.searchArticles({ query, rubro, articles: list })
      : list.filter((item) => {
        const searchable = norm([
          articleCode(item),
          item.nombre,
          item.descripcion,
          item.detalle,
          item.rubro,
          articleTags(item.tagsOcultos ?? item.tagsBusqueda ?? item.tags).join(' ')
        ].join(' '));
        return (!query || searchable.includes(norm(query))) && (!rubro || norm(item.rubro).includes(norm(rubro)));
      });
    const filtered = (Array.isArray(searched) ? searched : []).filter((item) => {
      const code = articleCode(item);
      return code && code !== articleEditorOriginalCode;
    }).slice(0, 250);
    targetList.innerHTML = filtered.length
      ? filtered.map((item) => {
        const code = articleCode(item);
        const name = String(item.nombre ?? item.descripcion ?? '');
        return `<label><input type="checkbox" data-editor-target-code="${code.replace(/"/g, '&quot;')}" ${articleEditorApplyTargets.has(code) ? 'checked' : ''}><b>${code}</b><span>${name}</span></label>`;
      }).join('')
      : '<div class="corralon-editor-empty">No hay artículos encontrados.</div>';
    articleEditorHost.querySelectorAll('[data-editor-apply-field]').forEach((button) => {
      const active = articleEditorApplyFields.has(button.dataset.editorApplyField);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const labelSelector = articleEditorHost.querySelector('[data-editor-apply-labels]');
    if (labelSelector) labelSelector.hidden = !articleEditorApplyFields.has('etiquetas');
    articleEditorHost.querySelectorAll('[data-editor-apply-label]').forEach((button) => {
      const active = articleEditorApplyLabels.has(button.dataset.editorApplyLabel);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    updateArticleEditorTargetCount();
  }

  function articleEditorTargetRubros() {
    const values = typeof articleEditorAdapter.getRubros === 'function'
      ? articleEditorAdapter.getRubros()
      : (articleEditorAdapter.getArticles?.() || []).map((item) => String(item.rubro || '').trim());
    return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  function closeArticleEditorRubroOptions() {
    articleEditorTargetRubroOpen = false;
    articleEditorTargetRubroIndex = -1;
    articleEditorHost?.querySelector('[data-editor-rubro-options]')?.classList.remove('is-open');
    articleEditorHost?.querySelector('[data-editor-target-rubro-toggle]')?.setAttribute('aria-expanded', 'false');
  }

  function renderArticleEditorRubroOptions(open = articleEditorTargetRubroOpen) {
    if (!articleEditorHost) return;
    const input = articleEditorHost.querySelector('[data-editor-target-rubro]');
    const options = articleEditorHost.querySelector('[data-editor-rubro-options]');
    if (!input || !options) return;
    const query = norm(input.value);
    const rubros = articleEditorTargetRubros().filter((item) => !query || norm(item).includes(query));
    const visible = [{ value: '', label: 'Todos los rubros' }, ...rubros.map((item) => ({ value: item, label: item }))];
    articleEditorTargetRubroIndex = Math.min(articleEditorTargetRubroIndex, visible.length - 1);
    options.innerHTML = visible.map((item, index) => `
      <button type="button" class="${index === articleEditorTargetRubroIndex ? 'is-active' : ''}" data-editor-rubro-option="${String(item.value).replace(/"/g, '&quot;')}">${item.label}</button>
    `).join('');
    articleEditorTargetRubroOpen = !!open;
    options.classList.toggle('is-open', articleEditorTargetRubroOpen);
    articleEditorHost.querySelector('[data-editor-target-rubro-toggle]')?.setAttribute('aria-expanded', String(articleEditorTargetRubroOpen));
  }

  function selectArticleEditorRubro(value) {
    const input = articleEditorHost?.querySelector('[data-editor-target-rubro]');
    if (!input) return;
    input.value = String(value || '');
    closeArticleEditorRubroOptions();
    renderArticleEditorTargets();
    input.focus();
    input.select();
  }

  function updateArticleEditorTargetCount() {
    const mainButton = articleEditorHost?.querySelector('[data-editor-apply-open]');
    if (mainButton) mainButton.textContent = articleEditorApplyTargets.size
      ? `Aplicar también a (${articleEditorApplyTargets.size})`
      : 'Aplicar cambios también a';
  }

  function openArticleEditorTargets() {
    if (!articleEditorHost) return;
    articleEditorApplyTargets = new Set();
    articleEditorApplyFields = new Set();
    articleEditorApplyLabels = new Set();
    articleEditorHost.querySelector('[data-editor-target-search]').value = String(
      articleEditorAdapter.getSearchQuery?.() || ''
    ).trim();
    articleEditorHost.querySelector('[data-editor-target-rubro]').value = '';
    closeArticleEditorRubroOptions();
    renderArticleEditorTargets();
    articleEditorHost.querySelector('[data-editor-apply-dialog]').classList.add('is-open');
    setTimeout(() => articleEditorHost.querySelector('[data-editor-target-search]')?.focus(), 0);
  }

  function applyArticleEditorFields(target, source, fields, labels = articleEditorApplyLabels) {
    const updated = { ...target };
    if (fields.has('etiquetas')) {
      if (labels.has('oferta')) {
        updated.oferta = source.oferta;
        updated.ofertaPct = source.ofertaPct;
        updated.ofertaHasta = source.ofertaHasta;
      }
      if (labels.has('destacado')) updated.destacado = source.destacado;
      if (labels.has('masVendido')) updated.masVendido = source.masVendido;
      if (labels.has('accesoRapido')) updated.accesoRapido = source.accesoRapido;
      if (labels.has('ceramico')) {
        updated.ceramico = source.ceramico;
        updated.ceramicoM2 = source.ceramicoM2;
        updated.ceramicoPlacas = source.ceramicoPlacas;
      }
    }
    if (fields.has('detalle')) updated.detalle = source.detalle;
    if (fields.has('tags')) {
      const tags = [...articleTags(source.tagsOcultos)];
      updated.tagsOcultos = tags;
      updated.tags_ocultos = [...tags];
    }
    if (fields.has('foto')) {
      const images = [...articleImages(source)];
      const primary = source.fotoUrl || images[0] || '';
      updated.fotoUrl = primary;
      updated.foto_url = primary;
      updated.imagen = primary;
      updated.imagenes = images;
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
      .corralon-article-editor-info-code{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
      .corralon-article-editor-info-sub-label{margin-top:4px;color:#666;font:800 11px/1 Arial,sans-serif;letter-spacing:.7px;text-transform:uppercase}
      .corralon-article-editor-info-sub-value{min-width:0;color:#171717;font:800 14px/1.3 Arial,sans-serif;overflow-wrap:anywhere}
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
      .corralon-article-editor-chip[hidden]{display:none!important}
      .corralon-article-editor-extras{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 14px;padding:14px 14px 2px;border:1px solid #ddd;border-radius:14px;background:#f7f7f5}
      .corralon-article-editor-section-title{grid-column:1/-1;font:900 13px/1 'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;color:#333}
      .corralon-article-editor-section-head{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}
      .corralon-article-editor-section-head .corralon-article-editor-section-title{grid-column:auto}
      .corralon-article-editor-paste{min-height:32px;border:1px solid #bbb;border-radius:9px;background:#fff;color:#171717;padding:0 14px;font:900 12px/1 Arial,sans-serif;cursor:pointer}
      .corralon-article-editor-paste:hover,.corralon-article-editor-paste:focus-visible{border-color:#777;background:#ededeb;outline:none}
      .corralon-article-editor-extras[hidden]{display:none!important}
      .corralon-article-editor-arid-prices{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .corralon-article-editor-arid-prices .corralon-article-editor-field{margin-bottom:0}
      .corralon-article-editor-arid-note{grid-column:1/-1;margin:-2px 0 10px;color:#666;font:700 11px/1.35 Arial,sans-serif}
      .corralon-article-editor-arid-divider{grid-column:1/-1;height:1px;margin:4px 0;background:#d2d2cf}
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
      .corralon-editor-target-filters{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(210px,.8fr);gap:9px;margin-bottom:10px}
      .corralon-editor-target-filter{display:grid;gap:5px;min-width:0;position:relative}
      .corralon-editor-target-filter>label{font:800 10px/1 Arial,sans-serif;letter-spacing:.65px;text-transform:uppercase;color:#666}
      .corralon-editor-target-search,.corralon-editor-target-rubro{width:100%;height:42px;box-sizing:border-box;border:1px solid #aaa;border-radius:11px;background:#fff;color:#171717;padding:10px 13px;font:14px/1 Arial,sans-serif;outline:none}
      .corralon-editor-target-search:focus,.corralon-editor-target-rubro:focus{border-color:#666;box-shadow:0 0 0 2px rgba(0,0,0,.08)}
      .corralon-editor-rubro-combo{position:relative}
      .corralon-editor-target-rubro{padding-right:42px}
      .corralon-editor-rubro-toggle{position:absolute;right:5px;top:5px;width:32px;height:32px;border:0;border-radius:8px;background:#eee;color:#222;font-size:15px;cursor:pointer;opacity:0;transition:opacity .12s}
      .corralon-editor-rubro-combo:hover .corralon-editor-rubro-toggle,.corralon-editor-rubro-combo:focus-within .corralon-editor-rubro-toggle{opacity:1}
      .corralon-editor-rubro-options{position:absolute;z-index:20;left:0;right:0;top:calc(100% + 4px);display:none;max-height:230px;overflow:auto;border:1px solid #aaa;border-radius:11px;background:#fff;padding:5px;box-shadow:0 12px 28px rgba(0,0,0,.22)}
      .corralon-editor-rubro-options.is-open{display:grid}
      .corralon-editor-rubro-options button{border:0;border-radius:8px;background:#fff;color:#222;padding:9px 10px;text-align:left;font-weight:700;cursor:pointer}
      .corralon-editor-rubro-options button:hover,.corralon-editor-rubro-options button.is-active{background:#dededb}
      .corralon-editor-target-list label{display:grid;grid-template-columns:24px 110px 1fr;align-items:center;gap:8px;border:1px solid #ddd;border-radius:9px;padding:8px;cursor:pointer}
      .corralon-editor-target-list label:hover{background:#eee}.corralon-editor-target-fields{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.corralon-editor-target-fields button{border:1px solid #bbb;border-radius:999px;background:#fff;padding:8px 12px;font-weight:800;cursor:pointer}.corralon-editor-target-fields button.is-active{background:#ef111b;border-color:#ef111b;color:#fff}
      .corralon-editor-label-fields{display:grid;gap:7px;margin:-2px 0 11px;padding:10px 12px;border:1px solid #ddd;border-radius:11px;background:#f5f5f3}.corralon-editor-label-fields[hidden]{display:none!important}.corralon-editor-label-fields>span{font:800 10px/1 Arial,sans-serif;letter-spacing:.65px;text-transform:uppercase;color:#666}.corralon-editor-label-options{display:flex;flex-wrap:wrap;gap:7px}.corralon-editor-label-options button{border:1px solid #bbb;border-radius:999px;background:#fff;color:#222;padding:7px 11px;font-weight:800;cursor:pointer}.corralon-editor-label-options button.is-active{border-color:#555;background:#555;color:#fff}
      .corralon-editor-subactions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.corralon-editor-subactions button{min-height:42px;border:1px solid #bbb;border-radius:10px;background:#fff;padding:0 18px;font-weight:900;cursor:pointer}.corralon-editor-subactions button:last-child{background:#ef111b;border-color:#ef111b;color:#fff}
      .corralon-editor-paste-copy{margin:0 0 10px;color:#666;font:700 12px/1.35 Arial,sans-serif}
      .corralon-editor-paste-area{width:100%;min-height:190px;box-sizing:border-box;resize:vertical;border:1px solid #aaa;border-radius:11px;background:#fff;color:#171717;padding:12px;font:13px/1.35 Consolas,monospace;outline:none}
      .corralon-editor-paste-area:focus{border-color:#666;box-shadow:0 0 0 2px rgba(0,0,0,.08)}
      .corralon-editor-empty{padding:22px;text-align:center;color:#777}
      @media(max-width:560px){.corralon-article-editor-host{padding:0}.corralon-article-editor-card{width:100%;max-height:100dvh;border-radius:0;padding:18px}.corralon-article-editor-head{margin:-18px -18px 14px;top:-18px;padding:16px 18px 13px}.corralon-article-editor-info{grid-template-columns:90px 1fr}.corralon-article-editor-info-price{grid-row:auto;grid-column:1/-1;align-items:flex-start;text-align:left;padding-top:10px;border-top:1px solid #ddd}.corralon-article-editor-main-grid,.corralon-article-editor-extras,.corralon-editor-target-filters{grid-template-columns:1fr}.corralon-article-editor-arid-prices{grid-template-columns:1fr 1fr}.corralon-article-editor-actions{margin:0 -18px -18px;padding:12px 18px 16px;grid-template-columns:1fr}.corralon-article-editor-actions button{min-height:42px}}
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
          <div class="corralon-article-editor-info-code">
            <div class="corralon-article-editor-info-value" data-editor-info="codigo"></div>
            <span class="corralon-article-editor-info-sub-label">codprov</span>
            <span class="corralon-article-editor-info-sub-value" data-editor-info="codigoProveedor"></span>
          </div>
          <div class="corralon-article-editor-info-value" data-editor-info="nombre"></div>
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
          <button type="button" class="corralon-article-editor-chip" data-editor-chip="arido" hidden>Árido</button>
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
        <div class="corralon-article-editor-extras" data-editor-extra="arido" hidden>
          <div class="corralon-article-editor-section-head">
            <div class="corralon-article-editor-section-title">Costos del árido por volumen</div>
            <button type="button" class="corralon-article-editor-paste" data-editor-arid-paste>Pegar</button>
          </div>
          <div class="corralon-article-editor-arid-prices">
            ${ARID_PRICE_TIERS.map((tier) => `
              <div class="corralon-article-editor-field">
                <label for="corralonEditArido_${tier.key}">${tier.label}</label>
                <input id="corralonEditArido_${tier.key}" data-editor-field="arido_${tier.key}" data-editor-number="2" data-editor-kind="money" inputmode="decimal">
              </div>`).join('')}
          </div>
          <div class="corralon-article-editor-arid-note">Estos importes son costos con IVA incluido y representan el total del material para cada cantidad de metros cúbicos.</div>
          <div class="corralon-article-editor-arid-divider"></div>
          <div class="corralon-article-editor-section-title">Costos comunes de fletes</div>
          <div class="corralon-article-editor-field"><label for="corralonEditAridoFleteId">ID artículo de flete</label><input id="corralonEditAridoFleteId" data-editor-field="aridoFleteId" type="text"></div>
          <div class="corralon-article-editor-field"><label for="corralonEditAridoFleteRawson">Costo flete Rawson por viaje</label><input id="corralonEditAridoFleteRawson" data-editor-field="aridoFleteRawson" data-editor-number="2" data-editor-kind="money" inputmode="decimal"></div>
          <div class="corralon-article-editor-field"><label for="corralonEditAridoFleteCalle5">Costo flete pasando Calle 5 por viaje</label><input id="corralonEditAridoFleteCalle5" data-editor-field="aridoFleteCalle5" data-editor-number="2" data-editor-kind="money" inputmode="decimal"></div>
          <div class="corralon-article-editor-arid-note">La configuración de flete es compartida por todos los artículos marcados como Árido.</div>
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
        <div class="corralon-editor-target-filters">
          <div class="corralon-editor-target-filter">
            <label for="corralonEditorTargetSearch">Buscar artículo</label>
            <input id="corralonEditorTargetSearch" class="corralon-editor-target-search" type="text" data-editor-target-search placeholder="Nombre, código, detalle, tags o filtros">
          </div>
          <div class="corralon-editor-target-filter">
            <label for="corralonEditorTargetRubro">Rubro</label>
            <div class="corralon-editor-rubro-combo">
              <input id="corralonEditorTargetRubro" class="corralon-editor-target-rubro" type="text" data-editor-target-rubro autocomplete="off" placeholder="Todos los rubros">
              <button class="corralon-editor-rubro-toggle" type="button" data-editor-target-rubro-toggle aria-label="Mostrar rubros" aria-expanded="false">▼</button>
              <div class="corralon-editor-rubro-options" data-editor-rubro-options></div>
            </div>
          </div>
        </div>
        <div class="corralon-editor-target-fields"><button type="button" data-editor-apply-field="etiquetas">Etiquetas</button><button type="button" data-editor-apply-field="detalle">Detalle</button><button type="button" data-editor-apply-field="tags">Tags</button><button type="button" data-editor-apply-field="foto">Fotos</button></div>
        <div class="corralon-editor-label-fields" data-editor-apply-labels>
          <span>Etiquetas a compartir</span>
          <div class="corralon-editor-label-options">
            <button type="button" data-editor-apply-label="oferta">En oferta</button>
            <button type="button" data-editor-apply-label="destacado">Destacado</button>
            <button type="button" data-editor-apply-label="masVendido">Más vendido</button>
            <button type="button" data-editor-apply-label="accesoRapido">Acceso rápido</button>
            <button type="button" data-editor-apply-label="ceramico">Cerámico</button>
          </div>
        </div>
        <div class="corralon-editor-target-list" data-editor-target-list></div>
        <div class="corralon-editor-subactions"><button type="button" data-editor-apply-close>Cancelar</button><button type="button" data-editor-apply-confirm>Confirmar selección</button></div>
      </div></div>
      <div class="corralon-editor-subdialog" data-editor-arid-paste-dialog><div class="corralon-editor-subcard">
        <div class="corralon-editor-subhead"><b>Pegar precios del árido</b><button type="button" data-editor-arid-paste-close>×</button></div>
        <p class="corralon-editor-paste-copy">Pegá la tabla completa. Se tomará automáticamente la columna correspondiente al árido abierto.</p>
        <textarea class="corralon-editor-paste-area" data-editor-arid-paste-area placeholder="Pegá acá la tabla de precios..."></textarea>
        <div class="corralon-editor-subactions"><button type="button" data-editor-arid-paste-close>Cancelar</button><button type="button" data-editor-arid-paste-confirm>Pegar valores</button></div>
      </div></div>`;
    document.body.appendChild(articleEditorHost);
    articleEditorHost.addEventListener('click', (event) => {
      if (event.target === articleEditorHost) closeArticleEditor();
      if (event.target.matches?.('[data-editor-images-dialog]')) {
        event.target.classList.remove('is-open');
        articleEditorHost.querySelector('[data-editor-images-open]')?.focus();
      }
      if (event.target.matches?.('[data-editor-apply-dialog]')) {
        closeArticleEditorRubroOptions();
        event.target.classList.remove('is-open');
        articleEditorHost.querySelector('[data-editor-apply-open]')?.focus();
      }
      if (event.target.matches?.('[data-editor-arid-paste-dialog]')) closeArticleEditorAridPasteDialog();
      if (event.target.closest('[data-editor-close]')) closeArticleEditor();
      const chip = event.target.closest('[data-editor-chip]');
      if (chip) {
        chip.classList.toggle('is-active');
        syncArticleEditorSections();
      }
      if (event.target.closest('[data-editor-arid-paste]')) pasteArticleEditorAridPrices();
      if (event.target.closest('[data-editor-arid-paste-close]')) closeArticleEditorAridPasteDialog();
      if (event.target.closest('[data-editor-arid-paste-confirm]')) {
        const text = articleEditorHost.querySelector('[data-editor-arid-paste-area]')?.value || '';
        try {
          applyArticleEditorAridPriceText(text);
          closeArticleEditorAridPasteDialog();
        } catch (error) {
          console.warn('No se pudieron pegar los precios del árido', error);
          alert(error?.message || 'No se pudo interpretar la tabla.');
        }
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
        closeArticleEditorRubroOptions();
        articleEditorHost.querySelector('[data-editor-apply-dialog]').classList.remove('is-open');
        articleEditorHost.querySelector('[data-editor-apply-open]')?.focus();
      }
      if (event.target.closest('[data-editor-target-rubro-toggle]')) {
        renderArticleEditorRubroOptions(!articleEditorTargetRubroOpen);
        articleEditorHost.querySelector('[data-editor-target-rubro]')?.focus();
      }
      const rubroOption = event.target.closest('[data-editor-rubro-option]');
      if (rubroOption) selectArticleEditorRubro(rubroOption.dataset.editorRubroOption);
      if (!event.target.closest('.corralon-editor-rubro-combo')) closeArticleEditorRubroOptions();
      const applyField = event.target.closest('[data-editor-apply-field]');
      if (applyField) {
        const key = applyField.dataset.editorApplyField;
        if (articleEditorApplyFields.has(key)) articleEditorApplyFields.delete(key);
        else articleEditorApplyFields.add(key);
        renderArticleEditorTargets();
      }
      const applyLabel = event.target.closest('[data-editor-apply-label]');
      if (applyLabel) {
        const key = applyLabel.dataset.editorApplyLabel;
        if (articleEditorApplyLabels.has(key)) articleEditorApplyLabels.delete(key);
        else articleEditorApplyLabels.add(key);
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
    const targetRubro = articleEditorHost.querySelector('[data-editor-target-rubro]');
    targetRubro.addEventListener('input', () => {
      articleEditorTargetRubroIndex = -1;
      renderArticleEditorRubroOptions(true);
      renderArticleEditorTargets();
    });
    targetRubro.addEventListener('keydown', (event) => {
      if (event.key === 'F4') {
        event.preventDefault();
        event.stopImmediatePropagation();
        renderArticleEditorRubroOptions(!articleEditorTargetRubroOpen);
        return;
      }
      if (event.key === 'Escape' && articleEditorTargetRubroOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeArticleEditorRubroOptions();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!articleEditorTargetRubroOpen) renderArticleEditorRubroOptions(true);
        const options = [...articleEditorHost.querySelectorAll('[data-editor-rubro-option]')];
        if (!options.length) return;
        articleEditorTargetRubroIndex = event.key === 'ArrowDown'
          ? Math.min(options.length - 1, articleEditorTargetRubroIndex + 1)
          : Math.max(0, articleEditorTargetRubroIndex < 0 ? options.length - 1 : articleEditorTargetRubroIndex - 1);
        renderArticleEditorRubroOptions(true);
        articleEditorHost.querySelector('[data-editor-rubro-option].is-active')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'Enter' && articleEditorTargetRubroOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const option = articleEditorHost.querySelectorAll('[data-editor-rubro-option]')[articleEditorTargetRubroIndex];
        if (option) selectArticleEditorRubro(option.dataset.editorRubroOption);
        else closeArticleEditorRubroOptions();
      }
    });
    targetRubro.addEventListener('blur', () => setTimeout(() => {
      if (!articleEditorHost?.querySelector('.corralon-editor-rubro-combo')?.contains(document.activeElement)) closeArticleEditorRubroOptions();
    }, 0));
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

  function splitAridClipboardRow(line) {
    const text = String(line || '').trim();
    if (!text) return [];
    if (text.includes('\t')) return text.split('\t').map((item) => item.trim());
    if (text.includes('|')) return text.split('|').map((item) => item.trim()).filter((item, index, list) => item || (index > 0 && index < list.length - 1));
    if (text.includes(';')) return text.split(';').map((item) => item.trim());
    return [text];
  }

  function aridClipboardColumnForArticle(article = {}, headers = []) {
    const articleText = norm([
      article.nombre,
      article.descripcion,
      article.detalle,
      article.codigoProveedor,
      article.codigo_proveedor,
      article.codprov
    ].filter(Boolean).join(' '));
    const wanted = articleText.includes('gruesa')
      ? ['gruesa']
      : articleText.includes('fina')
        ? ['fina']
        : (articleText.includes('clasif') || articleText.includes('19'))
          ? ['clasif', '19']
          : (articleText.includes('grancilla') || articleText.includes('piedra bola') || articleText.includes('p bola'))
            ? ['p bola', 'bola']
            : (articleText.includes('comun') || articleText.includes('base'))
              ? ['comun', 'base']
              : [];
    if (!wanted.length) return -1;
    return headers.findIndex((header) => {
      const normalized = norm(header).replace(/[._-]+/g, ' ');
      return wanted.some((token) => normalized.includes(token));
    });
  }

  function parseAridClipboardMoney(value) {
    let text = String(value ?? '').replace(/\$/g, '').replace(/\s+/g, '').trim();
    if (!text) return null;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
    text = text.replace(/[^0-9.-]/g, '');
    const number = Number(text);
    return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
  }

  function parseAridClipboardPrices(text) {
    const rows = String(text || '')
      .split(/\r?\n/)
      .map(splitAridClipboardRow)
      .filter((row) => row.length && !row.every((cell) => /^:?-{3,}:?$/.test(String(cell).trim())));
    if (!rows.length) throw new Error('No hay valores para pegar.');

    const list = articleEditorAdapter.getArticles?.() || [];
    const article = list.find((item) => articleCode(item) === articleEditorOriginalCode) || {};
    const headerIndex = rows.findIndex((row) => row.some((cell) => /mts|metros|gruesa|fina|comun|base|clasif|bola/i.test(norm(cell))));
    const headers = headerIndex >= 0 ? rows[headerIndex] : [];
    const valueColumn = headers.length ? aridClipboardColumnForArticle(article, headers) : -1;
    const prices = {};

    if (valueColumn >= 0) {
      rows.slice(headerIndex + 1).forEach((row) => {
        const meters = parseFlexibleNumber(row[0]);
        const tier = ARID_PRICE_TIERS.find((item) => Math.abs(item.meters - Number(meters)) < 0.001);
        const value = parseAridClipboardMoney(row[valueColumn]);
        if (tier && value !== null) prices[tier.key] = Math.max(0, value);
      });
    } else {
      const candidates = rows
        .slice(headerIndex >= 0 ? headerIndex + 1 : 0)
        .map((row) => row.length > 1 ? row[row.length - 1] : row[0])
        .map(parseAridClipboardMoney)
        .filter((value) => value !== null);
      ARID_PRICE_TIERS.forEach((tier, index) => {
        if (candidates[index] !== undefined) prices[tier.key] = Math.max(0, candidates[index]);
      });
    }

    if (Object.keys(prices).length !== ARID_PRICE_TIERS.length) {
      if (headers.length && valueColumn < 0) {
        throw new Error('No pude reconocer qué columna corresponde a este árido.');
      }
      throw new Error('La tabla debe contener los 9 valores, desde 1 hasta 5 m³.');
    }
    return prices;
  }

  function applyArticleEditorAridPriceText(text) {
    const prices = parseAridClipboardPrices(text);
    ARID_PRICE_TIERS.forEach((tier) => {
      const field = editorField(`arido_${tier.key}`);
      if (!field) return;
      field.value = prices[tier.key];
      formatArticleEditorNumber(field, 2, false);
    });
    const button = articleEditorHost?.querySelector('[data-editor-arid-paste]');
    if (button) {
      button.textContent = 'Pegado ✓';
      setTimeout(() => { if (button.isConnected) button.textContent = 'Pegar'; }, 1200);
    }
  }

  function openArticleEditorAridPasteDialog(initialText = '') {
    const dialog = articleEditorHost?.querySelector('[data-editor-arid-paste-dialog]');
    const area = articleEditorHost?.querySelector('[data-editor-arid-paste-area]');
    if (!dialog || !area) return;
    area.value = String(initialText || '');
    dialog.classList.add('is-open');
    setTimeout(() => area.focus(), 0);
  }

  function closeArticleEditorAridPasteDialog() {
    const dialog = articleEditorHost?.querySelector('[data-editor-arid-paste-dialog]');
    if (!dialog) return;
    dialog.classList.remove('is-open');
    articleEditorHost.querySelector('[data-editor-arid-paste]')?.focus();
  }

  async function pasteArticleEditorAridPrices() {
    const button = articleEditorHost?.querySelector('[data-editor-arid-paste]');
    if (!button) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!String(text || '').trim()) {
        openArticleEditorAridPasteDialog();
        return;
      }
      applyArticleEditorAridPriceText(text);
    } catch (error) {
      console.warn('El navegador no entregó el portapapeles; se habilitó el pegado manual', error);
      openArticleEditorAridPasteDialog();
    }
  }

  function populateArticleEditorAridFields(config = {}) {
    const normalized = normalizeAridConfig(config, articleEditorOriginalCode);
    ARID_PRICE_TIERS.forEach((tier) => {
      const field = editorField(`arido_${tier.key}`);
      if (field) field.value = normalized.precios[tier.key] || 0;
    });
    const freightId = editorField('aridoFleteId');
    const rawson = editorField('aridoFleteRawson');
    const calle5 = editorField('aridoFleteCalle5');
    if (freightId) freightId.value = aridosFreightConfig.idArtFlete;
    if (rawson) rawson.value = aridosFreightConfig.rawson || 0;
    if (calle5) calle5.value = aridosFreightConfig.pasandoCalle5 || 0;
    articleEditorHost?.querySelectorAll('[data-editor-extra="arido"] [data-editor-number]').forEach((field) => {
      formatArticleEditorNumber(field, Number(field.dataset.editorNumber || 2), false);
    });
  }

  function readArticleEditorAridConfig(code, active) {
    const prices = {};
    ARID_PRICE_TIERS.forEach((tier) => {
      prices[tier.key] = Math.max(0, Number(parseFlexibleNumber(editorField(`arido_${tier.key}`)?.value) || 0));
    });
    return normalizeAridConfig({ codigo: code, activo: active, precios: prices }, code);
  }

  function readArticleEditorFreightConfig() {
    return normalizeAridFreightConfig({
      idArtFlete: editorField('aridoFleteId')?.value,
      rawson: editorField('aridoFleteRawson')?.value,
      pasandoCalle5: editorField('aridoFleteCalle5')?.value
    });
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
    articleEditorApplyLabels = new Set(ARTICLE_EDITOR_LABEL_KEYS);
    articleEditorAridEligible = false;
    updateArticleEditorTargetCount();
    articleEditorReturnFocus = options.returnFocus || document.activeElement;
    editorInfo('codigo').textContent = articleCodeValue;
    editorInfo('nombre').textContent = String(article.nombre ?? article.descripcion ?? '');
    editorInfo('codigoProveedor').textContent = String(
      article.codigoProveedor ?? article.codigo_proveedor ?? article.idartprov ?? article.codprov ?? ''
    ).trim() || 'Sin código';
    editorInfo('rubro').textContent = String(article.rubro ?? '') || 'Sin rubro';
    articleEditorBasePrice = Number(article.precio || 0);
    editorField('detalle').value = String(article.detalle ?? '');
    editorField('tags').value = articleTags(article.tagsOcultos ?? article.tagsBusqueda ?? article.tags ?? '').join(', ');
    editorField('ofertaPct').value = Number(article.ofertaPct ?? article.oferta_pct ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    editorField('ofertaHasta').value = articleEditorDateToDisplay(article.ofertaHasta ?? article.oferta_hasta ?? '');
    editorField('ceramicoM2').value = Number(article.ceramicoM2 ?? article.m2 ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    editorField('ceramicoPlacas').value = Number(article.ceramicoPlacas ?? article.placas ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
    const articleAridConfig = aridConfigForArticle(article);
    const aridChip = host.querySelector('[data-editor-chip="arido"]');
    if (aridChip) {
      aridChip.hidden = true;
      aridChip.classList.remove('is-active');
    }
    populateArticleEditorAridFields(articleAridConfig);
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
        ceramico: article.ceramico,
        arido: false
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
    Promise.resolve(resolveAridEligibility(article)).then((eligible) => {
      if (articleEditorOriginalCode !== articleCodeValue || !host.classList.contains('is-open')) return;
      articleEditorAridEligible = Boolean(eligible);
      if (!aridChip) return;
      aridChip.hidden = !articleEditorAridEligible;
      aridChip.classList.toggle('is-active', articleEditorAridEligible && articleAridConfig.activo);
      syncArticleEditorSections();
    }).catch((error) => {
      console.warn('No se pudo comprobar el proveedor del árido', error);
    });
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
    articleEditorApplyFields = new Set();
    articleEditorApplyLabels = new Set(ARTICLE_EDITOR_LABEL_KEYS);
    articleEditorAridEligible = false;
    updateArticleEditorTargetCount();
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
      const aridActive = articleEditorAridEligible && active('arido');
      const aridConfig = readArticleEditorAridConfig(code, aridActive);
      const freightConfig = readArticleEditorFreightConfig();
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
        arido: aridActive,
        aridoPrecios: { ...aridConfig.precios },
        preciosArido: { ...aridConfig.precios },
        timestamp: Date.now()
      };
      const appliedTargets = [];
      const nextList = list.map((item) => {
        const itemCode = articleCode(item);
        if (itemCode === articleEditorOriginalCode) return updated;
        if (!articleEditorApplyTargets.has(itemCode)) return item;
        const applied = applyArticleEditorFields(item, updated, articleEditorApplyFields, articleEditorApplyLabels);
        appliedTargets.push(applied);
        return applied;
      });
      if (!articleEditorAdapter.save) throw new Error('El editor no está conectado a esta página');
      await articleEditorAdapter.save(nextList, updated, articleEditorOriginalCode, appliedTargets);
      if (articleEditorAridEligible) {
        const nextConfigs = new Map(aridosConfigMap);
        nextConfigs.set(aridCodeKey(code), aridConfig);
        setAridosConfigMap(nextConfigs);
        setAridosFreightConfig(freightConfig);
        const backgroundWrites = [];
        if (typeof aridosAdapter.saveArticleConfig === 'function') {
          backgroundWrites.push(Promise.resolve().then(() => aridosAdapter.saveArticleConfig(code, aridConfig)));
        }
        if (typeof aridosAdapter.saveFreightConfig === 'function') {
          backgroundWrites.push(Promise.resolve().then(() => aridosAdapter.saveFreightConfig(freightConfig)));
        }
        if (backgroundWrites.length) {
          Promise.all(backgroundWrites).catch((error) => {
            console.error('No se pudo sincronizar la configuración de áridos', error);
            window.dispatchEvent(new CustomEvent('corralon:article-sync-error', { detail: { error } }));
          });
        }
      }
      window.dispatchEvent(new CustomEvent('corralon:article-updated', {
        detail: { article: updated, articles: [updated, ...appliedTargets], previousCode: articleEditorOriginalCode }
      }));
      closeArticleEditor();
    } catch (error) {
      console.error(error);
      alert(error.message || 'No se pudo guardar el artículo');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Guardar cambios';
    }
  }

  function escapeAridHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function aridArticleName(article = {}) {
    return String(article.nombre ?? article.descripcion ?? article.articulo ?? '').trim();
  }

  function aridArticles() {
    const source = aridosAdapter.getArticles?.() || articleEditorAdapter.getArticles?.() || [];
    return source
      .map(decorateAridArticle)
      .filter((article) => articleCode(article) && aridConfigForArticle(article).activo);
  }

  function aridArticleByCode(code) {
    const key = aridCodeKey(code);
    return aridArticles().find((article) => aridCodeKey(articleCode(article)) === key) || null;
  }

  function normalizeAridMeters(value) {
    const parsed = Number(parseFlexibleNumber(value) || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.max(1, Math.ceil(parsed * 2 - 1e-9) / 2);
  }

  function aridTierForMeters(meters) {
    const normalized = Math.max(1, Math.min(5, Math.ceil(Number(meters || 1) * 2 - 1e-9) / 2));
    return ARID_PRICE_TIERS.find((tier) => tier.meters === normalized) || ARID_PRICE_TIERS[0];
  }

  function roundAridMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function aridArticleMargin(article = {}) {
    let margin = Number(article.margenGanancia ?? article.PorcGanMin ?? article.porcGanMin ?? 0);
    if (Math.abs(margin) > 1) margin /= 100;
    const cost = Number(article.precioCostoConImpuestos ?? article.PrecioCpraCI ?? article.precioCpraCI ?? 0);
    const sale = Number(article.precioVentaPublico ?? article.PrecioVta3 ?? article.precio ?? 0);
    if (!(margin > 0) && cost > 0 && sale > 0) margin = (sale / cost) - 1;
    return Number.isFinite(margin) ? Math.max(0, margin) : 0;
  }

  function aridSaleFromCost(cost, article) {
    return roundAridMoney(Number(cost || 0) * (1 + aridArticleMargin(article)));
  }

  function aridInputNumber(value, fallback = 0) {
    const evaluated = window.CorralonFunciones?.evaluateNumericExpression?.(String(value ?? ''));
    if (Number.isFinite(evaluated)) return evaluated;
    const parsed = parseFlexibleNumber(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function calculateAridMaterial(article, metersValue) {
    if (!article) return null;
    const meters = normalizeAridMeters(aridInputNumber(metersValue, 1));
    const config = aridConfigForArticle(article);
    const fullLoads = Math.floor(meters / 5);
    const remainder = Math.round((meters - fullLoads * 5) * 2) / 2;
    const fivePrice = Number(config.precios.m5 || 0);
    let costTotal = fullLoads * fivePrice;
    if (remainder > 0) {
      const tier = aridTierForMeters(remainder);
      costTotal += Number(config.precios[tier.key] || 0);
    }
    const marginRate = aridArticleMargin(article);
    const total = aridSaleFromCost(costTotal, article);
    return {
      article,
      code: articleCode(article),
      name: aridArticleName(article),
      meters,
      costTotal: roundAridMoney(costTotal),
      costUnit: meters ? roundAridMoney(costTotal / meters) : 0,
      marginRate,
      total,
      unitPrice: meters ? roundAridMoney(total / meters) : 0
    };
  }

  function isLocalAridExportAvailable() {
    return ['localhost', '127.0.0.1', '::1'].includes(String(location.hostname || '').toLowerCase());
  }

  function ensureAridosBudgetHost() {
    if (aridosBudgetHost?.isConnected) return aridosBudgetHost;
    const style = document.createElement('style');
    style.id = 'corralonAridosBudgetStyle';
    style.textContent = `
      .corralon-aridos-host{position:fixed;inset:0;z-index:2147483050;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(0,0,0,.72);font-family:Arial,sans-serif}
      .corralon-aridos-host.is-open{display:flex}
      .corralon-aridos-card{width:min(940px,100%);max-height:94dvh;overflow:auto;border:1px solid #c9c9c9;border-radius:18px;background:#fff;color:#171717;box-shadow:0 24px 70px rgba(0,0,0,.36)}
      .corralon-aridos-head{position:sticky;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 14px;border-bottom:1px solid #ddd;background:#fff}
      .corralon-aridos-head b{font:900 25px/1 'Barlow Condensed',Arial,sans-serif;text-transform:uppercase}
      .corralon-aridos-close{width:36px;height:36px;border:0;border-radius:50%;background:#eee;color:#222;font-size:22px;cursor:pointer}
      .corralon-aridos-body{display:grid;gap:12px;padding:16px 20px 18px}
      .corralon-aridos-table-wrap{overflow:auto;border:1px solid #c9c9c9;border-radius:14px;background:#fff}
      .corralon-aridos-table{width:100%;border-collapse:collapse;table-layout:fixed}
      .corralon-aridos-table th{padding:10px 12px;border-bottom:1px solid #c9c9c9;background:#ececea;color:#555;text-align:left;font:900 11px/1 Arial,sans-serif;letter-spacing:.55px;text-transform:uppercase}
      .corralon-aridos-table th:nth-child(2){width:145px}.corralon-aridos-table th:nth-child(3){width:175px;text-align:right}
      .corralon-aridos-table td{padding:9px 12px;border-bottom:1px solid #dedede;vertical-align:middle}
      .corralon-aridos-table tbody tr:nth-child(even){background:#f4f4f2}
      .corralon-aridos-table select,.corralon-aridos-table input{width:100%;height:38px;box-sizing:border-box;border:1px solid #aaa;border-radius:9px;background:#fff;color:#171717;padding:7px 9px;font:700 13px/1 Arial,sans-serif;outline:none}
      .corralon-aridos-table select:focus,.corralon-aridos-table input:focus{border-color:#555;box-shadow:0 0 0 2px rgba(0,0,0,.09)}
      .corralon-aridos-description{display:flex;align-items:center;gap:8px;min-width:0}
      .corralon-aridos-description-copy{min-width:0;flex:1}
      .corralon-aridos-description b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:900 16px/1.15 'Barlow Condensed',Arial,sans-serif;text-transform:uppercase}
      .corralon-aridos-description small{display:block;margin-top:3px;color:#6a6a6a;font-size:11px;font-weight:700}
      .corralon-aridos-remove{width:29px;height:29px;flex:0 0 29px;border:1px solid #bbb;border-radius:50%;background:#fff;color:#d90009;font-size:18px;font-weight:900;cursor:pointer}
      .corralon-aridos-price{text-align:right;font-size:15px;font-weight:900;white-space:nowrap}
      .corralon-aridos-add-row td{background:#fff}
      .corralon-aridos-add-row select{color:#555;font-weight:800}
      .corralon-aridos-freight-copy{display:grid;gap:7px}
      .corralon-aridos-freight-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .corralon-aridos-freight-line>b{font:900 16px/1 'Barlow Condensed',Arial,sans-serif;text-transform:uppercase}
      .corralon-aridos-freight-options{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .corralon-aridos-freight-options button{min-height:31px;border:1px solid #aaa;border-radius:999px;background:#fff;color:#222;padding:0 11px;font:800 11px/1 Arial,sans-serif;cursor:pointer}
      .corralon-aridos-freight-options button.is-active{border-color:#ef111b;background:#ef111b;color:#fff}
      .corralon-aridos-custom{display:grid;grid-template-columns:auto minmax(140px,220px);align-items:center;gap:8px}
      .corralon-aridos-custom[hidden]{display:none!important}
      .corralon-aridos-custom span{color:#666;font-size:11px;font-weight:800}
      .corralon-aridos-table tfoot td{border:0;background:#eee9ee;font-size:18px;font-weight:900}
      .corralon-aridos-table tfoot td:last-child{text-align:right}
      .corralon-aridos-warning{padding:10px 12px;border:1px solid #ff8a91;border-radius:11px;background:#fff0f1;color:#b50008;font-weight:800}
      .corralon-aridos-warning[hidden]{display:none!important}
      .corralon-aridos-actions{position:sticky;bottom:0;z-index:4;display:grid;grid-template-columns:1fr 1.35fr 1.35fr;gap:9px;padding:13px 20px 17px;border-top:1px solid #ddd;background:#fff}
      .corralon-aridos-actions button{min-height:45px;border:1px solid #bbb;border-radius:11px;background:#fff;color:#171717;font-weight:900;cursor:pointer}
      .corralon-aridos-actions button[data-arid-cart]{border-color:#ef111b;background:#ef111b;color:#fff}
      .corralon-aridos-actions button[data-arid-export]{border-color:#171717;background:#171717;color:#fff}
      .corralon-aridos-actions button[hidden]{display:none!important}
      @media(max-width:580px){
        .corralon-aridos-host{padding:0}.corralon-aridos-card{width:100%;max-height:100dvh;border-radius:0}
        .corralon-aridos-body{padding:10px}.corralon-aridos-table{min-width:650px}
        .corralon-aridos-actions{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
    aridosBudgetHost = document.createElement('div');
    aridosBudgetHost.className = 'corralon-aridos-host';
    aridosBudgetHost.setAttribute('aria-hidden', 'true');
    aridosBudgetHost.innerHTML = `
      <div class="corralon-aridos-card" role="dialog" aria-modal="true" aria-label="Presupuestar áridos">
        <div class="corralon-aridos-head"><b>Presupuestar áridos</b><button type="button" class="corralon-aridos-close" data-arid-close>×</button></div>
        <div class="corralon-aridos-body">
          <div class="corralon-aridos-table-wrap">
            <table class="corralon-aridos-table">
              <thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio</th></tr></thead>
              <tbody data-arid-table-body></tbody>
              <tfoot>
                <tr><td colspan="2">Costo de los artículos</td><td data-arid-cost>$ 0,00</td></tr>
                <tr><td colspan="2">Total</td><td data-arid-total>$ 0,00</td></tr>
              </tfoot>
            </table>
          </div>
          <div class="corralon-aridos-warning" data-arid-warning hidden></div>
        </div>
        <div class="corralon-aridos-actions">
          <button type="button" data-arid-close>Cancelar</button>
          <button type="button" data-arid-export>Generar XLS y actualizar</button>
          <button type="button" data-arid-cart>Agregar al carrito</button>
        </div>
      </div>`;
    document.body.appendChild(aridosBudgetHost);

    aridosBudgetHost.addEventListener('input', (event) => {
      const meters = event.target.closest('[data-arid-row-meters]');
      if (meters) {
        const index = Number(meters.closest('[data-arid-material-row]')?.dataset.index);
        if (aridosBudgetItems[index]) aridosBudgetItems[index].meters = meters.value;
        renderAridosBudgetValues();
      }
      if (event.target.matches('[data-arid-custom-rate]')) {
        aridosBudgetCustomRate = event.target.value;
        renderAridosBudgetValues();
      }
    });
    aridosBudgetHost.addEventListener('change', (event) => {
      const materialSelect = event.target.closest('[data-arid-material-select]');
      if (materialSelect) {
        const index = Number(materialSelect.closest('[data-arid-material-row]')?.dataset.index);
        if (aridosBudgetItems[index]) aridosBudgetItems[index].code = materialSelect.value;
        renderAridosBudgetRows(index);
        return;
      }
      const addSelect = event.target.closest('[data-arid-add]');
      if (addSelect?.value) {
        aridosBudgetItems.push({ code: addSelect.value, meters: '1' });
        renderAridosBudgetRows(aridosBudgetItems.length - 1);
      }
    });
    aridosBudgetHost.addEventListener('focusout', (event) => {
      const input = event.target.closest('[data-arid-row-meters],[data-arid-custom-rate]');
      if (!input) return;
      const evaluated = aridInputNumber(input.value, input.matches('[data-arid-custom-rate]') ? 0 : 1);
      if (input.matches('[data-arid-custom-rate]')) {
        aridosBudgetCustomRate = Math.max(0, evaluated);
        input.value = money(aridosBudgetCustomRate);
      } else {
        const index = Number(input.closest('[data-arid-material-row]')?.dataset.index);
        const normalized = normalizeAridMeters(evaluated);
        if (aridosBudgetItems[index]) aridosBudgetItems[index].meters = normalized;
        input.value = normalized.toLocaleString('es-AR', { maximumFractionDigits: 1 });
      }
      renderAridosBudgetValues();
    });
    aridosBudgetHost.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAridosBudget();
      if (event.key === 'Enter' && event.target.matches('[data-arid-row-meters],[data-arid-custom-rate]')) {
        event.preventDefault();
        event.target.blur();
      }
    });
    aridosBudgetHost.addEventListener('click', (event) => {
      if (event.target === aridosBudgetHost || event.target.closest('[data-arid-close]')) {
        closeAridosBudget();
        return;
      }
      const freight = event.target.closest('[data-arid-freight-option]');
      if (freight) {
        aridosBudgetFreightMode = freight.dataset.aridFreightOption || 'none';
        renderAridosBudgetValues();
        return;
      }
      const remove = event.target.closest('[data-arid-remove]');
      if (remove) {
        const index = Number(remove.closest('[data-arid-material-row]')?.dataset.index);
        if (index > 0) aridosBudgetItems.splice(index, 1);
        renderAridosBudgetRows(Math.max(0, index - 1));
        return;
      }
      if (event.target.closest('[data-arid-cart]')) addAridosBudgetToCart();
      if (event.target.closest('[data-arid-export]')) exportAridosBudgetXls();
    });
    window.CorralonFunciones?.bindLinearNavigation?.({
      root: aridosBudgetHost,
      selector: '[data-arid-material-select],[data-arid-row-meters],[data-arid-freight-option],[data-arid-custom-rate],[data-arid-add],[data-arid-export],[data-arid-cart],[data-arid-close]',
      selectOnFocus: true,
      navigateLeftRight: true,
      smartCaret: true,
      selectOnAnyFocus: true,
      selectOnFirstPointerFocus: true
    });
    return aridosBudgetHost;
  }

  function aridBudgetOptions(selectedCode = '', rowIndex = -1) {
    const used = new Set(aridosBudgetItems
      .filter((_, index) => index !== rowIndex)
      .map((item) => aridCodeKey(item.code)));
    return aridArticles()
      .filter((article) => !used.has(aridCodeKey(articleCode(article))) || aridCodeKey(articleCode(article)) === aridCodeKey(selectedCode))
      .map((article) => {
        const code = articleCode(article);
        const selected = aridCodeKey(code) === aridCodeKey(selectedCode) ? ' selected' : '';
        return `<option value="${escapeAridHtml(code)}"${selected}>${escapeAridHtml(code)} · ${escapeAridHtml(aridArticleName(article))}</option>`;
      }).join('');
  }

  function renderAridosBudgetRows(focusIndex = null) {
    if (!aridosBudgetHost) return;
    const body = aridosBudgetHost.querySelector('[data-arid-table-body]');
    if (!body) return;
    const materialRows = aridosBudgetItems.map((item, index) => {
      const article = aridArticleByCode(item.code);
      const description = `<div class="corralon-aridos-description">
        <div class="corralon-aridos-description-copy">
          <b>${escapeAridHtml(aridArticleName(article))}</b>
          <small>Código ${escapeAridHtml(articleCode(article))}</small>
        </div>
        ${index > 0 ? '<button type="button" class="corralon-aridos-remove" data-arid-remove aria-label="Quitar árido">×</button>' : ''}
      </div>`;
      return `<tr data-arid-material-row data-index="${index}">
        <td>${description}</td>
        <td><input data-arid-row-meters inputmode="decimal" value="${escapeAridHtml(String(item.meters ?? 1))}" aria-label="Metros cúbicos"></td>
        <td class="corralon-aridos-price" data-arid-row-price>$ 0,00</td>
      </tr>`;
    }).join('');
    body.innerHTML = `${materialRows}
      <tr data-arid-freight-row>
        <td>
          <div class="corralon-aridos-freight-copy">
            <div class="corralon-aridos-freight-line">
              <b>Flete</b>
              <div class="corralon-aridos-freight-options">
                <button type="button" data-arid-freight-option="none">Sin flete</button>
                <button type="button" data-arid-freight-option="rawson">Rawson</button>
                <button type="button" data-arid-freight-option="calle5">Pasando Calle 5</button>
                <button type="button" data-arid-freight-option="custom">Personalizado</button>
              </div>
            </div>
            <div class="corralon-aridos-custom" data-arid-custom hidden>
              <span>Costo por viaje</span>
              <input data-arid-custom-rate inputmode="decimal" value="${escapeAridHtml(money(aridInputNumber(aridosBudgetCustomRate, 0)))}">
            </div>
          </div>
        </td>
        <td class="corralon-aridos-price" data-arid-freight-quantity>0 viajes</td>
        <td class="corralon-aridos-price" data-arid-freight-price>$ 0,00</td>
      </tr>
      <tr class="corralon-aridos-add-row">
        <td><select data-arid-add aria-label="Agregar otro árido"><option value="">+ Agregar otro árido</option>${aridBudgetOptions('', -1)}</select></td>
        <td class="corralon-aridos-price">—</td>
        <td class="corralon-aridos-price">—</td>
      </tr>`;
    renderAridosBudgetValues();
    if (focusIndex !== null) {
      setTimeout(() => body.querySelector(`[data-arid-material-row][data-index="${focusIndex}"] [data-arid-row-meters]`)?.focus(), 0);
    }
  }

  function currentAridosBudget() {
    if (!aridosBudgetHost) return null;
    const materials = aridosBudgetItems
      .map((item) => calculateAridMaterial(aridArticleByCode(item.code), item.meters))
      .filter(Boolean);
    const totalMeters = materials.reduce((sum, item) => sum + item.meters, 0);
    const trips = totalMeters > 0 ? Math.ceil(totalMeters / 5) : 0;
    const freightMode = aridosBudgetFreightMode;
    const customRate = Math.max(0, aridInputNumber(aridosBudgetCustomRate, 0));
    const rate = freightMode === 'rawson'
      ? aridosFreightConfig.rawson
      : freightMode === 'calle5'
        ? aridosFreightConfig.pasandoCalle5
        : freightMode === 'custom'
          ? customRate
          : 0;
    const freightArticle = aridFreightArticle();
    const freightCostTotal = freightMode === 'none' ? 0 : roundAridMoney(rate * trips);
    const freightMarginRate = aridArticleMargin(freightArticle);
    const freightTotal = aridSaleFromCost(freightCostTotal, freightArticle);
    const materialTotal = materials.reduce((sum, item) => sum + item.total, 0);
    const materialCostTotal = materials.reduce((sum, item) => sum + item.costTotal, 0);
    return {
      materials,
      totalMeters,
      trips,
      freightMode,
      freightRate: rate,
      freightCostTotal,
      freightMarginRate,
      freightTotal,
      materialCostTotal,
      materialTotal,
      total: roundAridMoney(materialTotal + freightTotal)
    };
  }

  function distributeAridFreight(budget) {
    if (!budget?.materials?.length) return budget;
    let assignedCost = 0;
    const lastIndex = budget.materials.length - 1;
    const materials = budget.materials.map((item, index) => {
      const ratio = budget.totalMeters > 0 ? item.meters / budget.totalMeters : 0;
      const freightCostShare = index === lastIndex
        ? roundAridMoney(budget.freightCostTotal - assignedCost)
        : roundAridMoney(budget.freightCostTotal * ratio);
      assignedCost = roundAridMoney(assignedCost + freightCostShare);
      const freightTotalShare = aridSaleFromCost(freightCostShare, item.article);
      const materialCostTotal = item.costTotal;
      const materialTotal = item.total;
      const costTotal = roundAridMoney(materialCostTotal + freightCostShare);
      const total = roundAridMoney(materialTotal + freightTotalShare);
      return {
        ...item,
        materialCostTotal,
        materialTotal,
        freightCostShare,
        freightTotalShare,
        costTotal,
        total,
        costUnit: item.meters ? roundAridMoney(costTotal / item.meters) : 0,
        unitPrice: item.meters ? roundAridMoney(total / item.meters) : 0
      };
    });
    const freightTotal = roundAridMoney(materials.reduce((sum, item) => sum + item.freightTotalShare, 0));
    return {
      ...budget,
      materials,
      freightTotal,
      total: roundAridMoney(budget.materialTotal + freightTotal)
    };
  }

  function renderAridosBudgetValues() {
    if (!aridosBudgetHost) return;
    const custom = aridosBudgetHost.querySelector('[data-arid-custom]');
    if (custom) custom.hidden = aridosBudgetFreightMode !== 'custom';
    aridosBudgetHost.querySelectorAll('[data-arid-freight-option]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.aridFreightOption === aridosBudgetFreightMode);
    });
    const budget = distributeAridFreight(currentAridosBudget());
    if (!budget) return;
    budget.materials.forEach((item, index) => {
      const row = aridosBudgetHost.querySelector(`[data-arid-material-row][data-index="${index}"]`);
      const price = row?.querySelector('[data-arid-row-price]');
      if (price) {
        price.textContent = money(item.total);
        price.title = item.freightTotalShare > 0
          ? `Árido ${money(item.materialTotal)} + flete incluido ${money(item.freightTotalShare)}`
          : `Costo ${money(item.costTotal)} · margen ${(item.marginRate * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
      }
    });
    const freightQuantity = aridosBudgetHost.querySelector('[data-arid-freight-quantity]');
    const freightPrice = aridosBudgetHost.querySelector('[data-arid-freight-price]');
    const chargedTrips = budget.freightMode === 'none' ? 0 : budget.trips;
    if (freightQuantity) freightQuantity.textContent = `${chargedTrips} ${chargedTrips === 1 ? 'viaje' : 'viajes'}`;
    if (freightPrice) {
      freightPrice.textContent = budget.freightTotal > 0 ? 'Incluido' : money(0);
      freightPrice.title = budget.freightTotal > 0
        ? `${money(budget.freightTotal)} distribuido entre los áridos`
        : 'Sin flete';
    }
    const total = aridosBudgetHost.querySelector('[data-arid-total]');
    if (total) total.textContent = money(budget.total);
    const cost = aridosBudgetHost.querySelector('[data-arid-cost]');
    if (cost) cost.textContent = money(Number(budget.materialCostTotal || 0) + Number(budget.freightCostTotal || 0));
    const missing = budget.materials.filter((item) => !((item.materialCostTotal ?? item.costTotal) > 0));
    const warning = aridosBudgetHost.querySelector('[data-arid-warning]');
    if (warning) {
      warning.hidden = !missing.length;
      warning.textContent = missing.length ? `Falta cargar el precio correspondiente para: ${missing.map((item) => item.name).join(', ')}.` : '';
    }
  }

  function openAridosBudget(code, options = {}) {
    const article = aridArticleByCode(code);
    if (!article) return false;
    const host = ensureAridosBudgetHost();
    aridosBudgetArticleCode = articleCode(article);
    aridosBudgetReturnFocus = options.returnFocus || document.activeElement;
    aridosBudgetItems = [{ code: aridosBudgetArticleCode, meters: '1' }];
    aridosBudgetFreightMode = 'rawson';
    aridosBudgetCustomRate = 0;
    const exportButton = host.querySelector('[data-arid-export]');
    if (exportButton) exportButton.hidden = !isLocalAridExportAvailable();
    host.classList.add('is-open');
    host.setAttribute('aria-hidden', 'false');
    renderAridosBudgetRows(0);
    return true;
  }

  function closeAridosBudget() {
    if (!aridosBudgetHost) return;
    aridosBudgetHost.classList.remove('is-open');
    aridosBudgetHost.setAttribute('aria-hidden', 'true');
    aridosBudgetArticleCode = '';
    aridosBudgetItems = [];
    aridosBudgetFreightMode = 'none';
    aridosBudgetCustomRate = 0;
    aridosBudgetReturnFocus?.focus?.();
    aridosBudgetReturnFocus = null;
  }

  function aridFreightArticle() {
    const key = aridCodeKey(aridosFreightConfig.idArtFlete);
    const source = aridosAdapter.getArticles?.() || articleEditorAdapter.getArticles?.() || [];
    return source.find((article) => aridCodeKey(articleCode(article)) === key) || null;
  }

  function aridosBudgetPayload() {
    const budget = distributeAridFreight(currentAridosBudget());
    if (!budget) return null;
    const freightArticle = aridFreightArticle();
    return {
      ...budget,
      freight: budget.freightTotal > 0 ? {
        article: freightArticle,
        code: aridosFreightConfig.idArtFlete,
        name: budget.freightMode === 'rawson'
          ? 'FLETE RAWSON'
          : budget.freightMode === 'calle5'
            ? 'FLETE PASANDO CALLE 5'
            : 'FLETE PERSONALIZADO',
        quantity: 1,
        trips: budget.trips,
        costTotal: budget.freightCostTotal,
        costUnit: budget.freightCostTotal,
        marginRate: budget.freightMarginRate,
        total: budget.freightTotal,
        unitPrice: budget.freightTotal,
        mode: budget.freightMode
      } : null
    };
  }

  function validateAridosBudget(payload) {
    if (!payload?.materials?.length) return 'Elegí al menos un árido.';
    if (payload.materials.some((item) => !((item.materialCostTotal ?? item.costTotal) > 0))) return 'Falta cargar el costo del volumen elegido.';
    if (payload.freightMode !== 'none' && !(payload.freightRate > 0)) return 'Falta cargar el importe del flete elegido.';
    return '';
  }

  async function addAridosBudgetToCart() {
    const payload = aridosBudgetPayload();
    const error = validateAridosBudget(payload);
    if (error) return alert(error);
    if (typeof aridosAdapter.addToCart === 'function') await aridosAdapter.addToCart(payload);
    else window.dispatchEvent(new CustomEvent('corralon:aridos-add-cart', { detail: payload }));
    closeAridosBudget();
  }

  function aridXlsRow(article, name, price) {
    return {
      cod_proveedor: String(article?.idartprov ?? article?.codprov ?? '').trim(),
      articulo: String(name || aridArticleName(article)).trim(),
      precio_costo: Math.round(Number(price || 0) * 100) / 100,
      id_proveedor: articleProviderId(article)
    };
  }

  function aridUnifiedName(item, includeFreight) {
    if (!includeFreight) return item.name;
    const baseName = String(item.name || '')
      .replace(/\s+X\s+1\s*M(?:T|3)?(?:\s*\(M\))?\s*$/i, '')
      .trim();
    const meters = Number(item.meters || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
    return `VIAJE ${baseName} X ${meters} M3`;
  }

  async function exportAridosBudgetXls() {
    const payload = aridosBudgetPayload();
    const error = validateAridosBudget(payload);
    if (error) return alert(error);
    const rows = payload.materials.map((item) => aridXlsRow(
      item.article,
      aridUnifiedName(item, !!payload.freight),
      item.costUnit / ARID_COST_VAT_FACTOR
    ));
    if (rows.some((row) => !row.cod_proveedor || !row.id_proveedor)) {
      return alert('Uno de los artículos no tiene código o ID de proveedor para actualizar Access.');
    }
    if (typeof aridosAdapter.exportXls === 'function') await aridosAdapter.exportXls(payload, rows);
    else await saveBlobAs(buildArticlesXlsBlob(rows), 'Articulos.xls');
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
        closeArticleEditorRubroOptions();
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

  const NUMERIC_CALCULATOR = (() => {
    let ui = null;
    let state = null;

    function factor(value) {
      const parsed = parseFlexibleNumber(value);
      return Number.isFinite(parsed) && parsed !== 0 ? parsed : 1;
    }

    function calculate(value, divideBy, multiplyBy) {
      return Number(value || 0) / factor(divideBy) * factor(multiplyBy);
    }

    function ensureUi() {
      if (ui?.backdrop?.isConnected) return ui;
      if (!document.getElementById('corralonNumericCalculatorStyles')) {
        const style = document.createElement('style');
        style.id = 'corralonNumericCalculatorStyles';
        style.textContent = `
          .corralon-number-calc-backdrop{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(18,24,38,.58)}
          .corralon-number-calc-backdrop.is-visible{display:flex}
          .corralon-number-calc-modal{width:min(94vw,680px);background:#fff;border:2px solid #bde4ff;border-radius:18px;padding:26px;box-shadow:0 20px 50px rgba(16,32,59,.35);color:#172033}
          .corralon-number-calc-title{margin:0 0 18px;font:900 42px 'Barlow Condensed',Arial,sans-serif;color:#6557dd}
          .corralon-number-calc-grid{display:grid;grid-template-columns:240px minmax(0,1fr);border:1px solid #9bcfff}
          .corralon-number-calc-label,.corralon-number-calc-field{min-height:48px;border-bottom:1px solid #d9edff;padding:8px 12px;font:700 25px 'Barlow Condensed',Arial,sans-serif}
          .corralon-number-calc-label{display:flex;align-items:center;background:#eef8ff;color:#6d7190;cursor:pointer}
          .corralon-number-calc-field{padding:0}
          .corralon-number-calc-grid>:nth-last-child(-n+2){border-bottom:0}
          .corralon-number-calc-field input{box-sizing:border-box;width:100%;height:100%;min-height:48px;border:0;border-radius:0;padding:0 12px;text-align:right;box-shadow:none;font:700 25px 'Barlow Condensed',Arial,sans-serif}
          .corralon-number-calc-field input:focus{outline:0;box-shadow:inset 0 0 0 2px #7d6cff}
          .corralon-number-calc-field input[readonly]{font-weight:900;background:#fff;color:#172033}
          .corralon-number-calc-actions{display:flex;gap:12px;justify-content:flex-end;margin-top:18px}
          .corralon-number-calc-actions button{min-height:48px;padding:8px 18px;border:1px solid #c8d2e4;border-radius:10px;background:#fff;color:#172033;font:800 19px 'Barlow Condensed',Arial,sans-serif;cursor:pointer}
          .corralon-number-calc-actions button[data-number-calc-apply]{border-color:#7062f0;background:linear-gradient(180deg,#a9dfff,#7062f0);color:#fff}
          @media(max-width:620px){.corralon-number-calc-modal{padding:18px}.corralon-number-calc-title{font-size:32px}.corralon-number-calc-grid{grid-template-columns:1fr}.corralon-number-calc-label{min-height:34px;border-bottom:0}.corralon-number-calc-actions{flex-wrap:wrap}.corralon-number-calc-actions button{flex:1 1 130px}}
        `;
        document.head.appendChild(style);
      }
      const backdrop = document.createElement('div');
      backdrop.className = 'corralon-number-calc-backdrop';
      backdrop.innerHTML = `
        <div class="corralon-number-calc-modal" role="dialog" aria-modal="true" aria-labelledby="corralonNumberCalcTitle">
          <h2 class="corralon-number-calc-title" id="corralonNumberCalcTitle">Dividir / multiplicar</h2>
          <div class="corralon-number-calc-grid">
            <label class="corralon-number-calc-label" data-number-calc-label="original">Valor inicial</label>
            <div class="corralon-number-calc-field"><input data-number-calc-original readonly></div>
            <label class="corralon-number-calc-label" data-number-calc-label="divide">Dividir por</label>
            <div class="corralon-number-calc-field"><input data-number-calc-divide inputmode="decimal" autocomplete="off"></div>
            <label class="corralon-number-calc-label" data-number-calc-label="multiply">Multiplicar por</label>
            <div class="corralon-number-calc-field"><input data-number-calc-multiply inputmode="decimal" autocomplete="off"></div>
            <label class="corralon-number-calc-label" data-number-calc-label="result">Resultado</label>
            <div class="corralon-number-calc-field"><input data-number-calc-result readonly></div>
          </div>
          <div class="corralon-number-calc-actions">
            <button type="button" data-number-calc-cancel>Cancelar</button>
            <button type="button" data-number-calc-restore>Volver a original</button>
            <button type="button" data-number-calc-apply>Guardar</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);
      ui = {
        backdrop,
        modal: backdrop.firstElementChild,
        title: backdrop.querySelector('.corralon-number-calc-title'),
        originalLabel: backdrop.querySelector('[data-number-calc-label="original"]'),
        resultLabel: backdrop.querySelector('[data-number-calc-label="result"]'),
        original: backdrop.querySelector('[data-number-calc-original]'),
        divide: backdrop.querySelector('[data-number-calc-divide]'),
        multiply: backdrop.querySelector('[data-number-calc-multiply]'),
        result: backdrop.querySelector('[data-number-calc-result]'),
        cancel: backdrop.querySelector('[data-number-calc-cancel]'),
        restore: backdrop.querySelector('[data-number-calc-restore]'),
        apply: backdrop.querySelector('[data-number-calc-apply]')
      };
      const format = (value) => state?.formatValue?.(value) ?? Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const resultValue = () => calculate(state?.value || 0, ui.divide.value, ui.multiply.value);
      const update = () => { if (state) ui.result.value = format(resultValue()); };
      const restoreFocus = () => {
        const target = state?.returnFocus;
        requestAnimationFrame(() => {
          if (typeof target === 'function') target();
          else target?.focus?.({ preventScroll: true });
        });
      };
      const close = () => {
        if (!state) return;
        ui.backdrop.classList.remove('is-visible');
        const previous = state;
        state = null;
        const target = previous.returnFocus;
        requestAnimationFrame(() => {
          if (typeof target === 'function') target();
          else target?.focus?.({ preventScroll: true });
        });
      };
      const apply = () => {
        if (!state) return;
        const current = state;
        const result = resultValue();
        current.onApply?.(result, {
          original: current.value,
          divide: String(ui.divide.value || '').trim(),
          multiply: String(ui.multiply.value || '').trim()
        });
        close();
      };
      const restore = () => {
        if (!state) return;
        const current = state;
        if (current.onRestore) current.onRestore(current.value);
        else current.onApply?.(current.value, { original: current.value, divide: '', multiply: '', restored: true });
        close();
      };
      ui.divide.addEventListener('input', update);
      ui.multiply.addEventListener('input', update);
      ui.cancel.addEventListener('click', close);
      ui.apply.addEventListener('click', apply);
      ui.restore.addEventListener('click', restore);
      ui.backdrop.addEventListener('mousedown', (event) => { if (event.target === ui.backdrop) close(); });
      ui.modal.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Enter' && event.target === ui.apply) { event.preventDefault(); apply(); return; }
        if (event.key === 'Enter' && (event.target === ui.divide || event.target === ui.multiply) && String(event.target.value || '').trim()) {
          event.preventDefault();
          ui.apply.focus();
          return;
        }
        if (!['Enter', 'Tab', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
        event.preventDefault();
        const fields = [ui.divide, ui.multiply, ui.cancel, ui.restore, ui.apply];
        const current = fields.indexOf(event.target);
        if (current < 0) return;
        const backwards = event.shiftKey || event.key === 'ArrowUp' || event.key === 'ArrowLeft';
        const next = fields[(current + (backwards ? -1 : 1) + fields.length) % fields.length];
        next.focus();
        next.select?.();
      });
      backdrop.querySelectorAll('[data-number-calc-label]').forEach((label) => {
        label.addEventListener('click', () => {
          const key = label.dataset.numberCalcLabel;
          const target = key === 'divide' ? ui.divide : key === 'multiply' ? ui.multiply : null;
          target?.focus();
          target?.select?.();
        });
      });
      ui.update = update;
      ui.close = close;
      return ui;
    }

    function open(options = {}) {
      const value = Number(options.value);
      if (!Number.isFinite(value)) return false;
      const elements = ensureUi();
      state = {
        value,
        formatValue: typeof options.formatValue === 'function' ? options.formatValue : null,
        onApply: options.onApply,
        onRestore: options.onRestore,
        returnFocus: options.returnFocus || document.activeElement
      };
      elements.title.textContent = options.title || 'Dividir / multiplicar';
      elements.originalLabel.textContent = options.originalLabel || 'Valor inicial';
      elements.resultLabel.textContent = options.resultLabel || 'Resultado';
      elements.original.value = state.formatValue?.(value) ?? value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      elements.divide.value = options.divide ?? '';
      elements.multiply.value = options.multiply ?? '';
      elements.update();
      elements.backdrop.classList.add('is-visible');
      requestAnimationFrame(() => {
        const target = options.initialField === 'multiply' ? elements.multiply : elements.divide;
        target.focus();
        target.select();
      });
      return true;
    }

    return {
      open,
      close: () => ui?.close?.(),
      isOpen: () => !!state,
      calculate
    };
  })();

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
    imageGeneratorCatalogMemory = catalog;
    writeLargeCache(IMAGE_GENERATOR_CATALOG_KEY, { savedAt: Date.now(), articles: catalog })
      .then(() => { try { localStorage.removeItem(IMAGE_GENERATOR_CATALOG_KEY); } catch (_) {} })
      .catch((error) => console.warn('No se pudo guardar el catalogo del generador en IndexedDB', error));
    return catalog;
  }

  function getImageGeneratorCatalog() {
    if (Array.isArray(imageGeneratorCatalogMemory)) return imageGeneratorCatalogMemory;
    try {
      const parsed = JSON.parse(localStorage.getItem(IMAGE_GENERATOR_CATALOG_KEY) || '{}');
      if (Array.isArray(parsed.articles)) {
        imageGeneratorCatalogMemory = parsed.articles;
        writeLargeCache(IMAGE_GENERATOR_CATALOG_KEY, parsed)
          .then(() => { try { localStorage.removeItem(IMAGE_GENERATOR_CATALOG_KEY); } catch (_) {} })
          .catch(() => {});
        return imageGeneratorCatalogMemory;
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  async function getImageGeneratorCatalogAsync() {
    const immediate = getImageGeneratorCatalog();
    if (immediate.length) return immediate;
    const stored = await readLargeCache(IMAGE_GENERATOR_CATALOG_KEY).catch(() => null);
    imageGeneratorCatalogMemory = Array.isArray(stored?.articles) ? stored.articles : [];
    return imageGeneratorCatalogMemory;
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

  function openLargeCacheDb() {
    return openDb(LARGE_CACHE_DB, (database) => {
      if (!database.objectStoreNames.contains('cache')) database.createObjectStore('cache', { keyPath: 'id' });
    });
  }

  async function readLargeCache(id) {
    const database = await openLargeCacheDb();
    return new Promise((resolve, reject) => {
      const request = database.transaction('cache').objectStore('cache').get(String(id));
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async function writeLargeCache(id, value) {
    const database = await openLargeCacheDb();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('cache', 'readwrite');
      tx.objectStore('cache').put({ id: String(id), value, savedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
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

  function buildNewArticlesXlsBlob(articles) {
    const headers = ['IDArt', 'CodProveedor', 'Articulo', 'CodBarra', 'PrecioCosto', 'preciolista', 'PrecioVta', 'IDProveedor', 'IDRubro', 'IDMoneda', 'Nota', 'PorcIVA', 'PorcGanMin', 'PorcGanInt', 'PorcGanMay'];
    const dataRows = (articles || []).map((article) => [
      String(article.id_art || article.idart || '').padStart(6, '0'),
      String(article.cod_proveedor || article.codProveedor || '').trim(),
      String(article.articulo || article.descripcion || '').trim().toLocaleUpperCase('es-AR'),
      '',
      Number(article.precio_costo || 0),
      Number(article.precio_lista || article.precio_costo || 0),
      Number(article.precio_venta || 0),
      Number(article.id_proveedor || 0),
      Number(article.id_rubro || 0),
      Number(article.id_moneda || 1),
      String(article.nota || '').trim(),
      Number(article.porc_iva || 0),
      Number(article.porc_gan_min ?? article.margen ?? 0),
      Number(article.porc_gan_int ?? article.margen ?? 0),
      Number(article.porc_gan_may ?? article.margen ?? 0)
    ]);
    const rows = [headers, ...dataRows];

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
    for (const row of dataRows) {
      out.push('<Row>' + row.map((value, index) => xmlCell(value, [4, 5, 6, 7, 8, 9, 11, 12, 13, 14].includes(index) ? 'Number' : 'String')).join('') + '</Row>');
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

  const CATALOG_EDITOR_SESSION = (() => {
    const LOCAL_KEY = 'corralon_catalogo_editor_session_v1';
    const SESSION_KEY = 'corralon_catalogo_editor_session_temp_v1';

    function readStorage(storage, key) {
      try {
        const value = JSON.parse(storage.getItem(key) || 'null');
        if (!value?.token || Number(value.expiresAt || 0) <= Date.now()) {
          storage.removeItem(key);
          return null;
        }
        return value;
      } catch (_) {
        try { storage.removeItem(key); } catch (_) {}
        return null;
      }
    }

    function current() {
      return readStorage(sessionStorage, SESSION_KEY) || readStorage(localStorage, LOCAL_KEY);
    }

    function store(payload, persistent) {
      clear();
      /*
       * El menú y las páginas de trabajo viven en pestañas distintas.
       * sessionStorage no se comparte con pestañas que ya estaban abiertas.
       * La duración real sigue limitada por expiresAt en el servidor.
       */
      localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
      return payload;
    }

    function clear() {
      try { localStorage.removeItem(LOCAL_KEY); } catch (_) {}
      try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    }

    async function login(userId, password, persistent = false, userSnapshot = null) {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/catalogo-editor-sesion`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          action: 'login',
          userId: String(userId || ''),
          password: String(password || ''),
          persistent: Boolean(persistent),
          userSnapshot: userSnapshot || null
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || !payload?.token) {
        throw new Error(payload?.error || `No se pudo iniciar la sesión de administrador (${response.status})`);
      }
      store(payload, Boolean(persistent));
      return payload;
    }

    async function logout() {
      clear();
    }

    async function saveArticlesRequest(body) {
      const active = current();
      if (!active?.token) {
        const error = new Error('No hay una sesión de edición activa. Volvé al Menú principal, actualizalo e iniciá sesión.');
        error.code = 'editor_session_required';
        throw error;
      }
      const rawArticles = Array.isArray(body?.articles)
        ? body.articles
        : (body?.article ? [body.article] : []);
      const userId = String(active?.user?.id || active?.userId || active?.user_id || '').trim();
      const numberValue = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      const dateValue = (value) => {
        const text = String(value || '').trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
      };
      const edits = [...new Map(rawArticles.map((raw) => {
        const codigo = articleCode(raw);
        const imagenes = articleImages(raw);
        const fotoUrl = String(raw?.fotoUrl ?? raw?.foto_url ?? raw?.imagen ?? imagenes[0] ?? '').trim();
        if (fotoUrl && !imagenes.includes(fotoUrl)) imagenes.unshift(fotoUrl);
        return [codigo, {
          codigo,
          detalle: String(raw?.detalle || '').trim(),
          tags_ocultos: articleTags(raw?.tagsOcultos ?? raw?.tags_ocultos),
          foto_url: fotoUrl,
          imagenes,
          oferta: articleBool(raw?.oferta),
          oferta_pct: Math.max(0, Math.min(100, numberValue(raw?.ofertaPct ?? raw?.oferta_pct))),
          oferta_hasta: dateValue(raw?.ofertaHasta ?? raw?.oferta_hasta),
          destacado: articleBool(raw?.destacado),
          mas_vendido: articleBool(raw?.masVendido ?? raw?.mas_vendido),
          acceso_rapido: articleBool(raw?.accesoRapido ?? raw?.acceso_rapido),
          ceramico: articleBool(raw?.ceramico),
          ceramico_m2: Math.max(0, numberValue(raw?.ceramicoM2 ?? raw?.ceramico_m2)),
          ceramico_placas: Math.max(0, Math.trunc(numberValue(raw?.ceramicoPlacas ?? raw?.ceramico_placas))),
          updated_by: userId || 'menu-auth',
          updated_at: new Date().toISOString()
        }];
      }).filter(([codigo]) => codigo)).values()];
      if (!edits.length) return { ok: true, articles: [] };

      const editResponse = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.catalogEdits}?on_conflict=codigo`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(edits)
      });
      if (!editResponse.ok) {
        const detail = await editResponse.json().catch(() => ({}));
        const error = new Error(detail?.message || detail?.error || `No se pudo guardar el artículo (${editResponse.status})`);
        error.code = 'editor_save_failed';
        throw error;
      }

      const metaResponse = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.catalogMeta}?id=eq.principal&select=*`, {
        headers: headers(),
        cache: 'no-store'
      });
      const currentMetaRows = metaResponse.ok ? await metaResponse.json().catch(() => []) : [];
      const currentMeta = Array.isArray(currentMetaRows) && currentMetaRows[0] ? currentMetaRows[0] : {};
      const version = Math.max(Date.now(), Number(currentMeta.version || 0) + 1);
      const codes = edits.map((edit) => edit.codigo);
      const metaWrite = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.catalogMeta}?on_conflict=id`, {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({
          ...currentMeta,
          id: 'principal',
          version,
          previous_version: Number(currentMeta.version || 0) || null,
          change_mode: 'delta',
          changed_codes: codes,
          removed_codes: [],
          updated_at: new Date().toISOString()
        })
      });
      if (!metaWrite.ok) {
        const detail = await metaWrite.json().catch(() => ({}));
        const error = new Error(detail?.message || detail?.error || `Se guardó el artículo, pero no su versión (${metaWrite.status})`);
        error.code = 'editor_meta_save_failed';
        throw error;
      }
      return {
        ok: true,
        version,
        updated_by: active?.user?.nombre || active?.user?.name || userId || 'menu-auth',
        articles: []
      };
    }

    async function saveArticle(article) {
      return saveArticlesRequest({ article });
    }

    async function saveArticles(articles) {
      const unique = [...new Map((Array.isArray(articles) ? articles : [])
        .map((article) => [articleCode(article), article])
        .filter(([code]) => code)).values()];
      if (!unique.length) return { ok: true, articles: [] };
      return saveArticlesRequest({ articles: unique });
    }

    return { current, login, logout, clear, saveArticle, saveArticles };
  })();

  const CATALOG = (() => {
    const DB_NAME = 'corralon_catalogo_articulos_v1';
    const DB_VERSION = 1;
    const CACHE_ID = 'principal';
    const PAGE_SIZE = 1000;
    const INITIAL_PAGE_SIZE = 120;
    const CODE_INDEX_PAGE_CONCURRENCY = 6;
    const FIRESTORE_PROJECT = 'corralon-progreso';
    const FIRESTORE_API_KEY = 'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0';
    const SELECT_COLUMNS = [
      'codigo', 'codigo_proveedor', 'id_proveedor', 'nombre', 'rubro', 'id_rubro',
      'precio_compra_sin_descuento', 'precio_compra_con_impuestos',
      'porcentaje_ganancia_min', 'precio_venta', 'stock',
      'stock_progreso', 'stock_calle5',
      'sync_version', 'activo',
      'detalle', 'tags_ocultos', 'foto_url', 'imagenes',
      'oferta', 'oferta_pct', 'oferta_hasta', 'destacado',
      'mas_vendido', 'acceso_rapido', 'ceramico',
      'ceramico_m2', 'ceramico_placas', 'editado_por', 'edicion_updated_at'
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

    async function hasLocalCache() {
      const cached = await readCache();
      return Boolean(Array.isArray(cached?.rows) && cached.rows.length);
    }

    function cacheHasRubros(cached) {
      const rows = Array.isArray(cached?.rows) ? cached.rows : [];
      const rubroIds = new Set();
      rows.forEach((row) => {
        const id = Number(row?.id_rubro ?? row?.idRubro ?? row?.IDRubro ?? 0);
        const name = String(row?.rubro ?? row?.Rubros_Descripción ?? row?.rubro_descripcion ?? '').trim();
        if (Number.isInteger(id) && id > 0 && name) rubroIds.add(id);
      });
      // El catalogo real contiene muchos rubros. Una cache con uno solo suele
      // ser la portada parcial que se guardo antes de incorporar IDRubro.
      return rubroIds.size > 1;
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
        id_rubro: row.id_rubro === null || row.id_rubro === undefined ? '' : Number(row.id_rubro),
        idRubro: row.id_rubro === null || row.id_rubro === undefined ? '' : Number(row.id_rubro),
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
        detalle: String(row.detalle || ''),
        tagsOcultos: Array.isArray(row.tags_ocultos) ? row.tags_ocultos : [],
        tags_ocultos: Array.isArray(row.tags_ocultos) ? row.tags_ocultos : [],
        fotoUrl: String(row.foto_url || ''),
        foto_url: String(row.foto_url || ''),
        imagen: String(row.foto_url || ''),
        imagenes: Array.isArray(row.imagenes) ? row.imagenes : [],
        oferta: Boolean(row.oferta),
        ofertaPct: Number(row.oferta_pct || 0),
        oferta_pct: Number(row.oferta_pct || 0),
        ofertaHasta: String(row.oferta_hasta || ''),
        oferta_hasta: String(row.oferta_hasta || ''),
        destacado: Boolean(row.destacado),
        masVendido: Boolean(row.mas_vendido),
        mas_vendido: Boolean(row.mas_vendido),
        accesoRapido: Boolean(row.acceso_rapido),
        acceso_rapido: Boolean(row.acceso_rapido),
        ceramico: Boolean(row.ceramico),
        ceramicoM2: Number(row.ceramico_m2 || 0),
        ceramico_m2: Number(row.ceramico_m2 || 0),
        ceramicoPlacas: Number(row.ceramico_placas || 0),
        ceramico_placas: Number(row.ceramico_placas || 0),
        editadoPor: String(row.editado_por || ''),
        edicionUpdatedAt: row.edicion_updated_at || '',
        activo: row.activo !== false,
        active: row.activo !== false,
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
      const select = 'id,version,patch_version,total_articulos,last_full_version,change_mode,updated_at';
      const query = `${SUPABASE_URL}/rest/v1/${TABLES.catalogMeta}?id=eq.principal&select=${select}&limit=1`;
      const response = await fetch(query, { headers: headers(), cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    }

    function supabaseCatalogQuery(extra = '', options = {}) {
      const activeFilter = options.includeInactive ? '' : '&activo=eq.true';
      const order = String(options.order || 'codigo.asc');
      return `${SUPABASE_URL}/rest/v1/${TABLES.catalogPublic}?select=${encodeURIComponent(SELECT_COLUMNS)}${activeFilter}${extra}&order=${encodeURIComponent(order)}`;
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

    function articleNeedsHydration(article = {}) {
      return !String(article.id_proveedor ?? article.idProveedor ?? '').trim();
    }

    async function hydrateIncompleteRows(rows = [], requiredCodes = []) {
      const byCode = new Map((rows || []).map((row) => [codeOf(row), row]).filter(([code]) => code));
      const codes = [...new Set([
        ...(requiredCodes || []),
        ...[...byCode.values()].filter(articleNeedsHydration).map(codeOf)
      ].map((code) => String(code || '').trim()).filter(Boolean))];
      if (!codes.length) return { rows: [...byCode.values()], changedRows: [] };

      const fullRows = (await fetchSupabaseCodes(codes)).map(fromSupabase);
      fullRows.forEach((row) => {
        const code = codeOf(row);
        if (code) byCode.set(code, row);
      });
      return {
        rows: [...byCode.values()],
        changedRows: fullRows
      };
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

    async function fetchSupabasePriorityCodes() {
      const select = encodeURIComponent('codigo');
      const filter = encodeURIComponent('(oferta.eq.true,destacado.eq.true,mas_vendido.eq.true,acceso_rapido.eq.true)');
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLES.catalogEdits}?select=${select}&or=${filter}&limit=240`, {
        headers: headers(),
        cache: 'no-store'
      });
      if (!response.ok) return [];
      const rows = await response.json();
      return Array.isArray(rows) ? rows.map((row) => String(row?.codigo || '').trim()).filter(Boolean) : [];
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

    async function fetchSupabaseDeltaRange(version, from = 0, to = from + PAGE_SIZE - 1) {
      const safeVersion = Math.max(0, Math.trunc(Number(version || 0)));
      const query = supabaseCatalogQuery(`&sync_version=gt.${safeVersion}`, {
        includeInactive: true,
        order: 'sync_version.asc,codigo.asc'
      });
      const response = await fetch(query, {
        headers: headers({ Range: `${from}-${to}` }),
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Respuesta incremental de catalogo invalida');
      return rows;
    }

    async function fetchSupabaseDeltaRows(version) {
      const result = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const rows = await fetchSupabaseDeltaRange(version, from, from + PAGE_SIZE - 1);
        result.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return result;
    }

    async function fetchSupabaseCodeIndexRange(from = 0, to = from + PAGE_SIZE - 1) {
      const select = encodeURIComponent('codigo,codigo_proveedor,id_proveedor,nombre');
      const query = `${SUPABASE_URL}/rest/v1/${TABLES.catalogPublic}?select=${select}&activo=eq.true&order=codigo.asc`;
      const response = await fetch(query, {
        headers: headers({ Range: `${from}-${to}` }),
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Respuesta de codigos de catalogo invalida');
      return rows;
    }

    async function fetchSupabaseCodeIndexRows() {
      const result = [];
      const waveSize = PAGE_SIZE * CODE_INDEX_PAGE_CONCURRENCY;
      for (let waveStart = 0; ; waveStart += waveSize) {
        const pages = await Promise.all(Array.from(
          { length: CODE_INDEX_PAGE_CONCURRENCY },
          (_, page) => {
            const from = waveStart + (page * PAGE_SIZE);
            return fetchSupabaseCodeIndexRange(from, from + PAGE_SIZE - 1);
          }
        ));
        pages.forEach((rows) => result.push(...rows));
        if (pages.some((rows) => rows.length < PAGE_SIZE)) break;
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
        metaRow = await fetchMetaRow();
      } catch (error) {
        console.warn('No se pudo consultar la version del catalogo', error);
      }
      const version = Number(metaRow?.version || 0);
      const patchVersion = Number(metaRow?.patch_version || 0);
      return {
        cached,
        metaRow,
        metadataUrl,
        version,
        patchVersion,
        versionKnown: Boolean(metaRow),
        signature: `supabase-directo-v1|${version}`
      };
    }

    function metaCodeList(metaRow, field) {
      const value = metaRow?.[field];
      if (!Array.isArray(value)) return [];
      return [...new Set(value.map((code) => String(code || '').trim()).filter(Boolean))];
    }

    function canApplyDelta(context) {
      if (!Array.isArray(context?.cached?.rows) || !context.cached.rows.length) return false;
      if (String(context?.cached?.source || '') !== 'supabase') return false;
      const cachedVersion = Number(context?.cached?.version || 0);
      const lastFullVersion = Number(context?.metaRow?.last_full_version || 0);
      return cachedVersion > 0
        && lastFullVersion > 0
        && cachedVersion >= lastFullVersion
        && cachedVersion < Number(context?.version || 0);
    }

    function applySupabasePatch(article = {}, changes = {}) {
      const next = { ...article };
      const set = (names, value) => names.forEach((name) => { next[name] = value; });
      for (const [field, rawValue] of Object.entries(changes || {})) {
        switch (field) {
          case 'codigo_proveedor': set(['idartprov', 'codprov'], String(rawValue || '')); break;
          case 'id_proveedor': set(['idProveedor', 'id_proveedor'], String(rawValue || '')); break;
          case 'nombre': set(['nombre', 'descripcion'], String(rawValue || '')); break;
          case 'rubro': next.rubro = String(rawValue || ''); break;
          case 'id_rubro': set(['id_rubro', 'idRubro'], rawValue === null ? '' : Number(rawValue)); break;
          case 'precio_compra_sin_descuento': set(['precioCosto', 'precio_costo', 'PrecioCpraSISDto'], Number(rawValue || 0)); break;
          case 'precio_compra_con_impuestos': next.PrecioCpraCI = Number(rawValue || 0); break;
          case 'porcentaje_ganancia_min': next.PorcGanMin = Number(rawValue || 0); break;
          case 'precio_venta': set(['precio', 'PrecioVta3'], Number(rawValue || 0)); break;
          case 'stock': next.stock = rawValue === null ? '' : Number(rawValue); break;
          case 'stock_progreso': next.stockSucursalProgresoRuta = rawValue === null ? '' : Number(rawValue); break;
          case 'stock_calle5': next.stockSucursalCalle5Espana = rawValue === null ? '' : Number(rawValue); break;
          case 'detalle': next.detalle = String(rawValue || ''); break;
          case 'tags_ocultos': set(['tagsOcultos', 'tags_ocultos'], Array.isArray(rawValue) ? rawValue : []); break;
          case 'foto_url': set(['fotoUrl', 'foto_url', 'imagen'], String(rawValue || '')); break;
          case 'imagenes': next.imagenes = Array.isArray(rawValue) ? rawValue : []; break;
          case 'oferta': next.oferta = Boolean(rawValue); break;
          case 'oferta_pct': set(['ofertaPct', 'oferta_pct'], Number(rawValue || 0)); break;
          case 'oferta_hasta': set(['ofertaHasta', 'oferta_hasta'], String(rawValue || '')); break;
          case 'destacado': next.destacado = Boolean(rawValue); break;
          case 'mas_vendido': set(['masVendido', 'mas_vendido'], Boolean(rawValue)); break;
          case 'acceso_rapido': set(['accesoRapido', 'acceso_rapido'], Boolean(rawValue)); break;
          case 'ceramico': next.ceramico = Boolean(rawValue); break;
          case 'ceramico_m2': set(['ceramicoM2', 'ceramico_m2'], Number(rawValue || 0)); break;
          case 'ceramico_placas': set(['ceramicoPlacas', 'ceramico_placas'], Number(rawValue || 0)); break;
          case 'editado_por': next.editadoPor = String(rawValue || ''); break;
          case 'edicion_updated_at': next.edicionUpdatedAt = rawValue || ''; break;
          case 'activo': set(['activo', 'active'], rawValue !== false); break;
        }
      }
      delete next.sourceRows;
      delete next.source_rows;
      return next;
    }

    async function fetchSupabasePatchRows(version = 0, targetVersion = 0) {
      const result = [];
      const safeVersion = Math.max(0, Math.trunc(Number(version || 0)));
      const safeTarget = Math.max(0, Math.trunc(Number(targetVersion || 0)));
      const upper = safeTarget ? `&version=lte.${safeTarget}` : '';
      for (let from = 0; ; from += PAGE_SIZE) {
        const query = `${SUPABASE_URL}/rest/v1/${TABLES.catalogChanges}?select=version,codigo,cambios,eliminado&version=gt.${safeVersion}${upper}&order=version.asc`;
        const response = await fetch(query, {
          headers: headers({ Range: `${from}-${from + PAGE_SIZE - 1}` }),
          cache: 'no-store'
        });
        if (!response.ok) throw new Error(await response.text());
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('Respuesta de parches de catalogo invalida');
        result.push(...rows);
        if (rows.length < PAGE_SIZE) return result;
      }
    }

    function canApplyPatches(context) {
      return Array.isArray(context?.cached?.rows)
        && context.cached.rows.length
        && String(context.cached.source || '') === 'supabase'
        && Number(context.patchVersion || 0) > Number(context.cached.patchVersion || 0);
    }

    function startPatchLoad(context) {
      const loadKey = `${context.signature}|patches|${context.patchVersion}`;
      if (activeFullLoad?.key === loadKey) return activeFullLoad.promise;
      const promise = (async () => {
        try {
          const patches = await fetchSupabasePatchRows(context.cached.patchVersion, context.patchVersion);
          const merged = new Map(context.cached.rows.map((row) => [codeOf(row), row]));
          const changedCodes = new Set();
          const missingCodes = new Set();
          const removedCodes = [];
          for (const entry of patches) {
            const code = String(entry?.codigo || '').trim();
            if (!code) continue;
            const changes = entry?.cambios && typeof entry.cambios === 'object' ? entry.cambios : {};
            if (entry?.eliminado || changes.activo === false) {
              merged.delete(code);
              removedCodes.push(code);
              changedCodes.delete(code);
              continue;
            }
            if (!merged.has(code)) missingCodes.add(code);
            const current = merged.get(code) || { codigo: code, idart: code, idArt: code, activo: true, active: true };
            merged.set(code, applySupabasePatch(current, changes));
            changedCodes.add(code);
          }
          const hydrated = await hydrateIncompleteRows([...merged.values()], [...missingCodes]);
          const rows = hydrated.rows.sort((left, right) =>
            codeOf(left).localeCompare(codeOf(right), 'es', { numeric: true, sensitivity: 'base' })
          );
          const rowsByCode = new Map(rows.map((row) => [codeOf(row), row]));
          hydrated.changedRows.forEach((row) => changedCodes.add(codeOf(row)));
          const changedRows = [...changedCodes].map((code) => rowsByCode.get(code)).filter(Boolean);
          await writeCache({
            ...context.cached,
            signature: context.signature,
            version: context.version,
            patchVersion: context.patchVersion,
            rows,
            source: 'supabase'
          });
          window.dispatchEvent(new CustomEvent('corralon:catalog-delta', {
            detail: { changedRows, removedCodes, rows, version: context.version, patchVersion: context.patchVersion, source: 'supabase' }
          }));
          return rows;
        } catch (error) {
          console.warn('No se pudieron aplicar los parches del catalogo; se conserva la cache', error);
          return context.cached.rows;
        }
      })();
      activeFullLoad = { key: loadKey, promise };
      const clear = () => { if (activeFullLoad?.promise === promise) activeFullLoad = null; };
      promise.then(clear, clear);
      return promise;
    }

    async function alignCachedVersion(context) {
      const hydrated = await hydrateIncompleteRows(context.cached.rows);
      const rows = hydrated.rows.sort((left, right) =>
        codeOf(left).localeCompare(codeOf(right), 'es', { numeric: true, sensitivity: 'base' })
      );
      await writeCache({
        ...context.cached,
        signature: context.signature,
        version: context.version,
        patchVersion: context.patchVersion,
        rows,
        source: 'supabase'
      });
      if (hydrated.changedRows.length) {
        window.dispatchEvent(new CustomEvent('corralon:catalog-delta', {
          detail: {
            changedRows: hydrated.changedRows,
            removedCodes: [],
            rows,
            version: context.version,
            patchVersion: context.patchVersion,
            source: 'repair'
          }
        }));
      }
      return rows;
    }

    function startDeltaLoad(context, options = {}) {
      const loadKey = `${context.signature}|delta`;
      if (activeFullLoad?.key === loadKey) return activeFullLoad.promise;
      const promise = (async () => {
        try {
          const deltaRows = await fetchSupabaseDeltaRows(context.cached.version);
          const changedCodes = deltaRows.map((row) => String(row?.codigo || '').trim()).filter(Boolean);
          const removedCodes = deltaRows
            .filter((row) => row?.activo === false)
            .map((row) => String(row?.codigo || '').trim())
            .filter(Boolean);
          const changedRows = deltaRows.filter((row) => row?.activo !== false).map(fromSupabase);
          const removedSet = new Set(removedCodes);
          const changedSet = new Set(changedCodes);
          const merged = new Map();
          context.cached.rows.forEach((row) => {
            const code = codeOf(row);
            if (!code || removedSet.has(code) || changedSet.has(code)) return;
            merged.set(code, row);
          });
          changedRows.forEach((row) => merged.set(codeOf(row), row));
          const rows = [...merged.values()].sort((left, right) =>
            codeOf(left).localeCompare(codeOf(right), 'es', { numeric: true, sensitivity: 'base' })
          );
          await writeCache({
            ...context.cached,
            signature: context.signature,
            version: context.version,
            patchVersion: context.patchVersion,
            metadataUrl: context.metadataUrl,
            rows,
            source: 'supabase'
          });
          window.dispatchEvent(new CustomEvent('corralon:catalog-delta', {
            detail: { changedRows, removedCodes, rows, version: context.version, source: 'supabase' }
          }));
          return rows;
        } catch (error) {
          console.warn('No se pudo aplicar el delta del catalogo; se conserva la cache y se reintentara', error);
          return context.cached.rows;
        }
      })();
      activeFullLoad = { key: loadKey, promise };
      const clearActiveLoad = () => {
        if (activeFullLoad?.promise === promise) activeFullLoad = null;
      };
      promise.then(clearActiveLoad, clearActiveLoad);
      return promise;
    }

    function startCatalogLoad(context, options = {}) {
      if (canApplyPatches(context)) return startPatchLoad(context, options);
      if (Array.isArray(context?.cached?.rows)
          && context.cached.rows.length
          && String(context.cached.source || '') === 'supabase'
          && Object.prototype.hasOwnProperty.call(context.cached, 'patchVersion')
          && Number(context.cached.patchVersion || 0) === Number(context.patchVersion || 0)) {
        return alignCachedVersion(context);
      }
      return canApplyDelta(context)
        ? startDeltaLoad(context, options)
        : startFullLoad(context, options);
    }

    function startFullLoad(context, options = {}) {
      const allowFallback = options.fallback !== false;
      const loadKey = `${context.signature}|${allowFallback ? 'fallback' : 'direct'}`;
      if (activeFullLoad?.key === loadKey) return activeFullLoad.promise;
      const promise = (async () => {
        try {
          const baseRows = await fetchSupabaseRows();
          if (!baseRows.length) throw new Error('El catalogo de Supabase todavia esta vacio');
          const rows = baseRows.map(fromSupabase);
          await writeCache({
            signature: context.signature,
            version: context.version,
            patchVersion: context.patchVersion,
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
            patchVersion: context.patchVersion,
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
      if (IS_AUTOMATED_CRAWLER) {
        const context = await catalogContext(null);
        let initialRows = [];
        try {
          const directPriorityCodes = await fetchSupabasePriorityCodes();
          const priorityCodes = priorityCodesFromMetadata([], [...(options.priorityCodes || []), ...directPriorityCodes]);
          const baseRows = await fetchSupabaseInitialRows(priorityCodes, options.initialLimit);
          initialRows = baseRows.map(fromSupabase);
        } catch (error) {
          console.warn('No se pudo preparar la portada reducida para el rastreador', error);
        }
        return {
          initialRows,
          complete: Promise.resolve(initialRows),
          fromCache: false,
          crawlerPreview: true,
          version: context.version
        };
      }

      const force = Boolean(options.force);
      const storedCache = await readCache();
      // Una cache anterior a IDRubro no sirve para los selectores de rubros.
      // Se ignora una sola vez y el siguiente full load vuelve a guardarla completa.
      const cached = cacheHasRubros(storedCache) ? storedCache : null;
      if (!force && Array.isArray(cached?.rows) && cached.rows.length) {
        const complete = (async () => {
          const context = await catalogContext(cached);
          if (!context.versionKnown || (
            cached.signature === context.signature
            && Number(cached.patchVersion || 0) === Number(context.patchVersion || 0)
          )) return cached.rows;
          return startCatalogLoad(context, options);
        })();
        return {
          initialRows: cached.rows,
          complete,
          fromCache: true,
          version: Number(cached.version || 0)
        };
      }

      const context = await catalogContext(cached);
      let initialRows = [];
      try {
        const directPriorityCodes = await fetchSupabasePriorityCodes();
        const priorityCodes = priorityCodesFromMetadata([], [...(options.priorityCodes || []), ...directPriorityCodes]);
        const baseRows = await fetchSupabaseInitialRows(priorityCodes, options.initialLimit);
        initialRows = baseRows.map(fromSupabase);
      } catch (error) {
        console.warn('No se pudo preparar la portada del catalogo', error);
      }
      return {
        initialRows,
        complete: startCatalogLoad(context, options),
        fromCache: false,
        version: context.version
      };
    }

    async function load(options = {}) {
      const progressive = await loadProgressive(options);
      return progressive.complete;
    }

    async function refresh(options = {}) {
      const cached = await readCache();
      if (!Array.isArray(cached?.rows) || !cached.rows.length) {
        const rows = await load(options);
        return { changed: true, mode: 'full', rows };
      }
      const context = await catalogContext(cached);
      if (!context.versionKnown || (
        cached.signature === context.signature
        && Number(cached.patchVersion || 0) === Number(context.patchVersion || 0)
      )) {
        return { changed: false, mode: 'none', rows: cached.rows };
      }
      const mode = canApplyPatches(context) ? 'patch' : (canApplyDelta(context) ? 'delta' : 'full');
      const rows = await startCatalogLoad(context, options);
      return { changed: true, mode, rows, version: context.version };
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

    async function fetchArticle(code) {
      const safeCode = String(code || '').trim();
      if (!safeCode) return null;
      const response = await fetch(supabaseCatalogQuery(`&codigo=eq.${encodeURIComponent(safeCode)}&limit=1`), {
        headers: headers(),
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      return Array.isArray(rows) && rows[0] ? fromSupabase(rows[0]) : null;
    }

    async function repairCachedArticle(code) {
      const article = await fetchArticle(code);
      if (!article) return null;
      const safeCode = codeOf(article);
      const cached = await readCache();
      if (!safeCode || !Array.isArray(cached?.rows)) return article;
      const byCode = new Map(cached.rows.map((row) => [codeOf(row), row]).filter(([key]) => key));
      byCode.set(safeCode, article);
      const rows = [...byCode.values()].sort((left, right) =>
        codeOf(left).localeCompare(codeOf(right), 'es', { numeric: true, sensitivity: 'base' })
      );
      await writeCache({ ...cached, rows });
      window.dispatchEvent(new CustomEvent('corralon:catalog-delta', {
        detail: { changedRows: [article], removedCodes: [], rows, version: cached.version, source: 'repair' }
      }));
      return article;
    }

    async function saveArticleEdits(articles) {
      const requested = [...new Map((Array.isArray(articles) ? articles : [])
        .map((article) => [codeOf(article), article])
        .filter(([code]) => code)).values()];
      if (!requested.length) return { ok: true, articles: [] };
      const payload = await CATALOG_EDITOR_SESSION.saveArticles(requested);
      let updatedArticles = Array.isArray(payload?.articles)
        ? payload.articles.map(fromSupabase)
        : [];
      if (!updatedArticles.length) {
        updatedArticles = (await Promise.all(requested.map((article) => fetchArticle(codeOf(article))))).filter(Boolean);
      }
      if (updatedArticles.length && Array.isArray(memoryCache?.rows)) {
        const byCode = new Map(updatedArticles.map((article) => [codeOf(article), article]));
        const rows = memoryCache.rows.map((row) => {
          const updated = byCode.get(codeOf(row));
          return updated ? { ...row, ...updated } : row;
        });
        await writeCache({
          ...memoryCache,
          signature: `supabase-directo-v1|${Number(payload?.version || memoryCache.version || 0)}`,
          version: Number(payload?.version || memoryCache.version || 0),
          rows,
          source: 'supabase'
        });
      }
      return { ...payload, article: updatedArticles[0] || null, articles: updatedArticles };
    }

    async function saveArticleEdit(article) {
      const result = await saveArticleEdits([article]);
      return { ...result, article: result.articles?.[0] || null };
    }

    return {
      load,
      loadProgressive,
      refresh,
      clearCache,
      hasLocalCache,
      getConfigUrl,
      fetchSupabaseInitialRows,
      fetchSupabaseRows,
      fetchCodeIndexRows: fetchSupabaseCodeIndexRows,
      fetchArticle,
      repairArticle: repairCachedArticle,
      saveArticleEdit,
      saveArticleEdits,
      mergeMetadata,
      fromSupabase
    };
  })();

  const CATALOG_REALTIME = (() => {
    const LEADER_KEY = 'corralon_catalog_realtime_leader_v1';
    const MESSAGE_KEY = 'corralon_catalog_realtime_message_v1';
    const CHANNEL_NAME = 'corralon_catalog_realtime_v1';
    const LEASE_MS = 15000;
    const RENEW_MS = 5000;
    const tabId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    let started = false;
    let leader = false;
    let leaseTimer = null;
    let refreshTimer = null;
    let broadcast = null;
    let supabaseClient = null;
    let realtimeChannel = null;
    let realtimeLibraryPromise = null;

    function readLeader() {
      try {
        const value = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null');
        return value && typeof value === 'object' ? value : null;
      } catch (_) {
        return null;
      }
    }

    function writeLeader(expiresAt) {
      try {
        localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId, expiresAt }));
        return readLeader()?.tabId === tabId;
      } catch (_) {
        return true;
      }
    }

    function announceCatalogChange() {
      const message = { type: 'catalog-change', sender: tabId, at: Date.now() };
      try { broadcast?.postMessage(message); } catch (_) {}
      try { localStorage.setItem(MESSAGE_KEY, JSON.stringify(message)); } catch (_) {}
    }

    function scheduleRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        CATALOG.refresh({ fallback: false }).catch((error) => {
          console.warn('No se pudo aplicar la actualizacion en tiempo real del catalogo', error);
        });
      }, 80);
    }

    function loadRealtimeLibrary() {
      if (window.supabase?.createClient) return Promise.resolve(window.supabase);
      if (realtimeLibraryPromise) return realtimeLibraryPromise;
      realtimeLibraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('vendor/supabase.js?v=20260812-catalog-realtime1', document.baseURI).href;
        script.async = true;
        script.onload = () => window.supabase?.createClient
          ? resolve(window.supabase)
          : reject(new Error('No se encontro el cliente Realtime de Supabase'));
        script.onerror = () => reject(new Error('No se pudo cargar el cliente Realtime de Supabase'));
        document.head.appendChild(script);
      });
      return realtimeLibraryPromise;
    }

    async function disconnectRealtime() {
      if (realtimeChannel && supabaseClient) {
        try { await supabaseClient.removeChannel(realtimeChannel); } catch (_) {}
      }
      realtimeChannel = null;
      supabaseClient = null;
    }

    async function connectRealtime() {
      if (realtimeChannel || !leader) return;
      try {
        const library = await loadRealtimeLibrary();
        if (!leader || realtimeChannel) return;
        supabaseClient = library.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { headers: { 'x-client-info': 'corralon-catalog-realtime' } }
        });
        realtimeChannel = supabaseClient
          .channel('catalogo-meta-principal-v1')
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: TABLES.catalogMeta,
            filter: 'id=eq.principal'
          }, () => {
            announceCatalogChange();
            scheduleRefresh();
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') scheduleRefresh();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              const failedChannel = realtimeChannel;
              realtimeChannel = null;
              if (failedChannel && supabaseClient) {
                try { supabaseClient.removeChannel(failedChannel); } catch (_) {}
              }
            }
          });
      } catch (error) {
        console.warn('Realtime de catalogo no disponible; se reintentara', error);
        realtimeChannel = null;
        supabaseClient = null;
      }
    }

    function evaluateLeadership() {
      const now = Date.now();
      const current = readLeader();
      const canClaim = !current || current.tabId === tabId || Number(current.expiresAt || 0) <= now;
      const shouldLead = canClaim && writeLeader(now + LEASE_MS);
      document.documentElement.dataset.catalogRealtimeLeader = shouldLead ? 'true' : 'false';
      if (shouldLead) {
        leader = true;
        connectRealtime();
      } else if (leader) {
        leader = false;
        disconnectRealtime();
      }
    }

    function onStorage(event) {
      if (event.key === MESSAGE_KEY && event.newValue) {
        try {
          const message = JSON.parse(event.newValue);
          if (message?.sender !== tabId && message?.type === 'catalog-change') scheduleRefresh();
        } catch (_) {}
      }
      if (event.key === LEADER_KEY) evaluateLeadership();
    }

    function start() {
      if (started) return;
      if (IS_AUTOMATED_CRAWLER) {
        document.documentElement.dataset.catalogRealtimeLeader = 'crawler-disabled';
        return;
      }
      started = true;
      if ('BroadcastChannel' in window) {
        broadcast = new BroadcastChannel(CHANNEL_NAME);
        broadcast.onmessage = (event) => {
          if (event.data?.sender !== tabId && event.data?.type === 'catalog-change') scheduleRefresh();
        };
      }
      window.addEventListener('storage', onStorage);
      window.addEventListener('focus', evaluateLeadership);
      document.addEventListener('visibilitychange', evaluateLeadership);
      window.addEventListener('pagehide', () => {
        if (leader && readLeader()?.tabId === tabId) {
          try { localStorage.removeItem(LEADER_KEY); } catch (_) {}
        }
      }, { once: true });
      evaluateLeadership();
      leaseTimer = setInterval(evaluateLeadership, RENEW_MS);
    }

    return {
      start,
      isLeader: () => leader
    };
  })();

  const FALTANTES = (() => {
    const INDEX_CACHE_KEY = 'corralon_index_lista_articulos_cache_v1';
    const LIST_DB = 'corralon_lista_proveedores_v1';
    const PROVIDER_LIST_META_KEY = 'corralon_lista_proveedores_meta_v1';
    const LOCAL_KEY = 'corralon_faltantes_rows_v2';
    const SUGGESTIONS_KEY = 'corralon_faltantes_sugerencias_v1';
    const ROWS_DB = 'corralon_faltantes_cache_v1';
    const ROWS_CACHE_ID = 'filas';
    const ROWS_SYNC_ID = 'sync';
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
    let localRowsMemory = null;
    let localRowsHydratePromise = null;
    let lastGeneratedSyncId = 0;

    function nextSyncId() {
      const candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      lastGeneratedSyncId = Math.max(candidate, lastGeneratedSyncId + 1);
      return lastGeneratedSyncId;
    }

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
      const stock = firstNumber(item.StockAct, item.stockAct, item.stock_act, item.stock, item.Stock);
      const iva = firstNumber(item.PorcIVA, item.porcIVA, item.porc_iva, item.iva, item.IVA, 21);
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
        precioFinal,
        stock,
        iva
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
        syncId: Number(item.sync_id || item.syncId || 0),
        eliminado: Boolean(item.eliminado),
        source: item.origen || 'index'
      };
    }

    function rowToRemote(row, orden = 0, syncId = 0) {
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
        sync_id: Number(syncId || row.syncId || 0),
        eliminado: false,
        origen: row.source || '',
        orden: Number.isFinite(Number(row.orden)) ? Number(row.orden) : orden,
        updatedAt: window.firebase?.firestore?.FieldValue?.serverTimestamp ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now()
      };
    }

    function localFiltroKey() {
      return `${LOCAL_KEY}_filtro`;
    }

    function readLegacyLocalRows() {
      try {
        return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') || [];
      } catch {
        return [];
      }
    }

    function openRowsDb() {
      return openDb(ROWS_DB, (database) => {
        if (!database.objectStoreNames.contains('cache')) database.createObjectStore('cache', { keyPath: 'id' });
      });
    }

    async function writeLocalRowsCache(rows) {
      const database = await openRowsDb();
      await new Promise((resolve, reject) => {
        const tx = database.transaction('cache', 'readwrite');
        tx.objectStore('cache').put({ id: ROWS_CACHE_ID, rows: rows || [], savedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }

    async function loadSyncCursor() {
      try {
        const database = await openRowsDb();
        return await new Promise((resolve, reject) => {
          const request = database.transaction('cache').objectStore('cache').get(ROWS_SYNC_ID);
          request.onsuccess = () => resolve(Number(request.result?.cursor || 0));
          request.onerror = () => reject(request.error);
        });
      } catch (_) { return 0; }
    }

    async function saveSyncCursor(cursor) {
      const value = Number(cursor || 0);
      const database = await openRowsDb();
      await new Promise((resolve, reject) => {
        const tx = database.transaction('cache', 'readwrite');
        tx.objectStore('cache').put({ id: ROWS_SYNC_ID, cursor: value, savedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return value;
    }

    async function loadLocalRowsAsync() {
      if (Array.isArray(localRowsMemory)) return localRowsMemory;
      if (localRowsHydratePromise) return localRowsHydratePromise;
      localRowsHydratePromise = (async () => {
        const legacy = readLegacyLocalRows();
        if (legacy.length) {
          localRowsMemory = legacy;
          await writeLocalRowsCache(legacy);
          try { localStorage.removeItem(LOCAL_KEY); } catch (_) {}
          return localRowsMemory;
        }
        try {
          const database = await openRowsDb();
          localRowsMemory = await new Promise((resolve, reject) => {
            const request = database.transaction('cache').objectStore('cache').get(ROWS_CACHE_ID);
            request.onsuccess = () => resolve(Array.isArray(request.result?.rows) ? request.result.rows : []);
            request.onerror = () => reject(request.error);
          });
        } catch (error) {
          console.warn('No se pudo leer Faltantes desde IndexedDB', error);
          localRowsMemory = [];
        }
        return localRowsMemory;
      })();
      return localRowsHydratePromise;
    }

    function loadLocalRows() {
      if (Array.isArray(localRowsMemory)) return localRowsMemory;
      const legacy = readLegacyLocalRows();
      if (legacy.length) {
        localRowsMemory = legacy;
        writeLocalRowsCache(legacy).then(() => { try { localStorage.removeItem(LOCAL_KEY); } catch (_) {} }).catch(() => {});
        return localRowsMemory;
      }
      loadLocalRowsAsync().catch(() => {});
      return [];
    }

    function buildSuggestionSummary(rows = []) {
      const groups = new Map();
      for (const row of rows || []) {
        if (isBlank(row) || row?.pedido) continue;
        const branchId = String(row.sucursalId || row.sucursal_id || '').trim();
        const branch = normalizeBranch(branchId || row.sucursal || '');
        const providerId = cleanId(row.idProveedor || row.id_proveedor || '');
        const provider = String(row.proveedor || '').trim();
        if (!branchId || (!providerId && !provider)) continue;
        const providerKey = providerId || searchNorm(provider);
        const key = `${providerKey}|${branchId}`;
        if (!groups.has(key)) groups.set(key, {
          key,
          providerId,
          provider,
          branchId,
          branch,
          articleCount: 0,
          quantityTotal: 0,
          updatedAt: Date.now()
        });
        const group = groups.get(key);
        group.articleCount += 1;
        group.quantityTotal += Number(row.cantidad || 0);
      }
      return [...groups.values()].sort((a, b) => b.articleCount - a.articleCount || String(a.provider).localeCompare(String(b.provider), 'es'));
    }

    function refreshSuggestionSummary(rows = loadLocalRows()) {
      const summary = buildSuggestionSummary(rows);
      try { localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(summary)); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('corralon:faltantes-summary', { detail: summary })); } catch (_) {}
      return summary;
    }

    function loadSuggestionSummary(limit = 5) {
      let summary = [];
      try { summary = JSON.parse(localStorage.getItem(SUGGESTIONS_KEY) || '[]') || []; } catch (_) {}
      if (!Array.isArray(summary) || !summary.length) summary = refreshSuggestionSummary();
      return summary.slice(0, Math.max(0, Number(limit) || 5));
    }

    function saveLocalRows(rows, columnFiltro = '') {
      localRowsMemory = Array.isArray(rows) ? rows : [];
      try { localStorage.setItem(localFiltroKey(), String(columnFiltro || '')); } catch (_) {}
      writeLocalRowsCache(localRowsMemory)
        .then(() => { try { localStorage.removeItem(LOCAL_KEY); } catch (_) {} })
        .catch((error) => console.warn('No se pudo guardar Faltantes en IndexedDB', error));
      refreshSuggestionSummary(localRowsMemory);
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
      const rows = snap.docs.map(firebaseRowFromDoc).filter((row) => !row.eliminado);
      const maxSyncId = rows.reduce((max, row) => Math.max(max, Number(row.syncId || 0)), 0);
      await saveSyncCursor(maxSyncId || 1);
      return rows;
    }

    async function loadRemoteChanges(afterSyncId = 0) {
      const db = firebaseDatabase();
      if (!db) return [];
      const snap = await db.collection(COLLECTION).where('sync_id', '>', Number(afterSyncId || 0)).orderBy('sync_id', 'asc').get();
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

    function subscribeChanges(afterSyncId, onRows, onError = console.warn) {
      const db = firebaseDatabase();
      if (!db) return null;
      return db.collection(COLLECTION).where('sync_id', '>', Number(afterSyncId || 0)).orderBy('sync_id', 'asc').onSnapshot(
        (snapshot) => onRows(snapshot.docChanges().filter((change) => change.type !== 'removed').map((change) => firebaseRowFromDoc(change.doc))),
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
        row.syncId = nextSyncId();
        batch.set(db.collection(COLLECTION).doc(row.localUid), rowToRemote(row, index, row.syncId), { merge: true });
      });
      await batch.commit();
    }

    async function saveChangedRows(rows, pendingUids) {
      const db = firebaseDatabase();
      if (!db) return;
      const wanted = new Set([...(pendingUids || [])].map(String));
      if (!wanted.size) return;
      const changed = (rows || [])
        .map((row, orden) => ({ row, orden }))
        .filter(({ row }) => !isBlank(row) && wanted.has(String(row.localUid || '')));
      for (let offset = 0; offset < changed.length; offset += 450) {
        const batch = db.batch();
        changed.slice(offset, offset + 450).forEach(({ row, orden }) => {
          if (!row.localUid) row.localUid = makeLocalUid();
          row.syncId = nextSyncId();
          batch.set(db.collection(COLLECTION).doc(row.localUid), rowToRemote(row, orden, row.syncId), { merge: true });
        });
        await batch.commit();
      }
    }

    async function addRow(row) {
      const item = {
        ...blankRow(row?.filtro || '', row?.source || 'proveedores'),
        ...row,
        localUid: row?.localUid || makeLocalUid(),
        pedido: Boolean(row?.pedido)
      };
      const localRows = await loadLocalRowsAsync();
      localRows.push(item);
      saveLocalRows(localRows, loadColumnFiltro());
      const db = firebaseDatabase();
      if (db) {
        item.syncId = nextSyncId();
        await db.collection(COLLECTION).doc(item.localUid).set(rowToRemote(item, Date.now(), item.syncId), { merge: true });
      }
      return item;
    }

    async function deleteRowsByUid(uids) {
      const db = firebaseDatabase();
      const valid = [...(uids || [])].filter(Boolean);
      if (!db || !valid.length) return;
      const batch = db.batch();
      valid.forEach((uid) => {
        const syncId = nextSyncId();
        batch.set(db.collection(COLLECTION).doc(uid), { local_uid: uid, eliminado: true, sync_id: syncId, updatedAt: window.firebase?.firestore?.FieldValue?.serverTimestamp ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now() }, { merge: true });
      });
      await batch.commit();
    }

    async function readIndexCache() {
      try {
        let raw = await readLargeCache(INDEX_CACHE_KEY);
        if (!raw) {
          try { raw = JSON.parse(localStorage.getItem(INDEX_CACHE_KEY) || 'null'); } catch (_) {}
          if (raw) {
            await writeLargeCache(INDEX_CACHE_KEY, raw);
            try { localStorage.removeItem(INDEX_CACHE_KEY); } catch (_) {}
          }
        }
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
        await writeLargeCache(INDEX_CACHE_KEY, { url, savedAt: Date.now(), data });
        try { localStorage.removeItem(INDEX_CACHE_KEY); } catch (_) {}
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
        const raw = await readLargeCache(INDEX_CACHE_KEY);
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
        let updated;
        if (useProviderList) {
          updated = await readProviderArticlesRemoteIfChanged();
        } else {
          const refresh = await CATALOG.refresh({ fallback: true });
          if (!refresh.changed) return false;
          updated = refresh.rows;
        }
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
      SUGGESTIONS_KEY,
      COLLECTION,
      searchNorm,
      makeLocalUid,
      blankRow,
      isBlank,
      loadLocalRows,
      loadLocalRowsAsync,
      buildSuggestionSummary,
      refreshSuggestionSummary,
      loadSuggestionSummary,
      saveLocalRows,
      loadColumnFiltro,
      loadRemoteRows,
      loadRemoteChanges,
      subscribeRows,
      subscribeChanges,
      loadSyncCursor,
      saveSyncCursor,
      nextSyncId,
      saveRows,
      saveChangedRows,
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

  function applyProviderEditorLayout(options = {}) {
    const resolve = (value, scope = document) => typeof value === 'string' ? scope.querySelector(value) : value;
    const root = resolve(options.root);
    if (!root) return null;
    const modal = resolve(options.modal, root) || (root.matches('.modal,.provider-modal,form') ? root : root.querySelector('.modal,.provider-modal,form'));
    const grid = resolve(options.grid, modal || root) || (modal || root).querySelector('.modal-grid,.provider-edit-grid,.provider-modal-grid');
    if (!modal || !grid) return null;

    if (!document.getElementById('corralon-provider-editor-style')) {
      const style = document.createElement('style');
      style.id = 'corralon-provider-editor-style';
      style.textContent = `
        .corralon-provider-editor{width:min(94vw,920px)!important;max-height:min(94vh,760px)!important;background:#fff!important;border:1px solid #d9d9d6!important;border-radius:18px!important;box-shadow:0 24px 70px rgba(20,20,20,.28)!important;overflow:auto!important}
        .corralon-provider-editor .corralon-provider-editor-head{padding:12px 18px!important;min-height:58px!important;background:#fff!important;border-bottom:1px solid #e3e3df!important;display:flex!important;align-items:center!important;gap:10px!important}
        .corralon-provider-editor-head .corralon-provider-head-copy{display:flex;flex-direction:column;gap:1px;min-width:0;margin-right:auto}
        .corralon-provider-editor-head .corralon-provider-head-copy>span:first-child{font:900 25px/1 'Barlow Condensed',sans-serif!important;color:#171717!important}
        .corralon-provider-editor-head .corralon-provider-editor-subtitle{font:700 12px/1.2 Barlow,sans-serif;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .corralon-provider-editor .corralon-provider-editor-grid{display:flex!important;flex-direction:column!important;gap:8px!important;padding:10px 18px!important}
        .corralon-provider-section{border:1px solid #e2e2de;border-radius:11px;padding:8px 10px;background:#fff}
        .corralon-provider-section-title{margin:0 0 6px;font:900 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.05em;color:#191919;text-transform:uppercase}
        .corralon-provider-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px}
        .corralon-provider-field{display:grid;grid-template-columns:128px minmax(0,1fr);align-items:center;gap:7px;min-width:0}
        .corralon-provider-field>label{margin:0!important;font:800 13px/1.1 'Barlow Condensed',sans-serif!important;color:#666!important;align-self:center!important}
        .corralon-provider-field>input,.corralon-provider-field>textarea,.corralon-provider-field>select{width:100%!important;min-width:0!important;height:32px!important;margin:0!important;padding:4px 8px!important;border:1px solid #c9c9c5!important;border-radius:7px!important;background:#fff!important;color:#171717!important;box-shadow:none!important}
        .corralon-provider-field>input:focus,.corralon-provider-field>textarea:focus,.corralon-provider-field>select:focus{border-color:#ef1015!important;box-shadow:0 0 0 2px rgba(239,16,21,.12)!important;outline:0!important}
        .corralon-provider-field.is-check{grid-template-columns:128px 1fr}
        .corralon-provider-field.is-check>input{width:18px!important;height:18px!important;justify-self:start}
        .corralon-provider-section.is-notes{background:#fffaf0;border-color:#eadbb8}
        .corralon-provider-section.is-notes .corralon-provider-fields{display:block}
        .corralon-provider-field.is-note{display:block}
        .corralon-provider-field.is-note>label{display:none}
        .corralon-provider-field.is-note>textarea{height:72px!important;min-height:72px!important;resize:vertical!important;background:#fffdf8!important}
        .corralon-provider-note-help{margin-top:4px;font:600 11px/1.2 Barlow,sans-serif;color:#8a7652}
        .corralon-provider-editor .corralon-provider-editor-actions{display:flex!important;justify-content:flex-end!important;align-items:center!important;gap:8px!important;padding:9px 18px 11px!important;border-top:1px solid #e3e3df!important;background:#fff!important}
        .corralon-provider-editor-actions .danger,.corralon-provider-editor-actions [id*="delete" i]{margin-right:auto!important}
        .corralon-provider-editor-actions button{min-height:34px!important;padding:6px 16px!important;border-radius:8px!important}
        @media(max-width:700px){.corralon-provider-editor{width:96vw!important}.corralon-provider-fields{grid-template-columns:1fr}.corralon-provider-field{grid-template-columns:118px minmax(0,1fr)}.corralon-provider-editor .corralon-provider-editor-grid{padding:8px!important}.corralon-provider-editor .corralon-provider-editor-actions{padding:8px!important}}
      `;
      document.head.appendChild(style);
    }

    modal.classList.add('corralon-provider-editor');
    grid.classList.add('corralon-provider-editor-grid');
    const head = modal.querySelector('.modal-head,.provider-modal-head');
    const actions = modal.querySelector('.modal-actions,.provider-modal-actions');
    if (head) {
      head.classList.add('corralon-provider-editor-head');
      let copy = head.querySelector('.corralon-provider-head-copy');
      if (!copy) {
        copy = document.createElement('div');
        copy.className = 'corralon-provider-head-copy';
        [...head.children].filter((node) => node.tagName !== 'BUTTON').forEach((node) => copy.appendChild(node));
        head.prepend(copy);
      }
      if (!copy.querySelector('.corralon-provider-editor-subtitle')) {
        const subtitle = document.createElement('small');
        subtitle.className = 'corralon-provider-editor-subtitle';
        copy.appendChild(subtitle);
      }
    }
    actions?.classList.add('corralon-provider-editor-actions');

    const labels = {
      id: 'IDProveedor', name: 'Proveedor', seller: 'Vendedor', phone: 'Teléfono', page: 'Página web', date: 'Última actualización',
      invoice: 'Dto. precio unit.', final: 'Dto. pronto pago', list: 'Dto. lista', freight: 'Porc. flete', iva: 'Porc. IVA',
      ivaIncluded: 'IVA incluido en lista', note: 'Nota'
    };
    const fieldGroups = {
      general: ['name', 'id', 'seller', 'phone', 'page', 'date'],
      commercial: ['invoice', 'final', 'list', 'freight', 'iva', 'ivaIncluded'],
      notes: ['note']
    };
    const fields = options.fields || {};
    const makeField = (key) => {
      const control = resolve(fields[key], modal);
      if (!control) return null;
      let label = control.id ? modal.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
      if (!label && control.previousElementSibling?.tagName === 'LABEL') label = control.previousElementSibling;
      const wrap = document.createElement('div');
      wrap.className = `corralon-provider-field${key === 'ivaIncluded' ? ' is-check' : ''}${key === 'note' ? ' is-note' : ''}`;
      if (label) {
        label.textContent = labels[key] || label.textContent;
        if (control.id) label.htmlFor = control.id;
        wrap.appendChild(label);
      }
      wrap.appendChild(control);
      return wrap;
    };
    const sectionData = [
      ['general', 'Datos del proveedor'],
      ['commercial', 'Condiciones comerciales'],
      ['notes', 'Notas y forma de trabajo']
    ];
    if (!grid.dataset.corralonProviderLayout) {
      const used = new Set();
      sectionData.forEach(([groupKey, title]) => {
        const section = document.createElement('section');
        section.className = `corralon-provider-section${groupKey === 'notes' ? ' is-notes' : ''}`;
        const heading = document.createElement('h3');
        heading.className = 'corralon-provider-section-title';
        heading.textContent = title;
        const body = document.createElement('div');
        body.className = 'corralon-provider-fields';
        fieldGroups[groupKey].forEach((key) => {
          const field = makeField(key);
          if (field) { body.appendChild(field); used.add(field.querySelector('input,textarea,select')); }
        });
        if (!body.children.length) return;
        section.append(heading, body);
        if (groupKey === 'notes') {
          const help = document.createElement('div');
          help.className = 'corralon-provider-note-help';
          help.textContent = 'Condiciones, bonificaciones y observaciones operativas del proveedor.';
          section.appendChild(help);
        }
        grid.appendChild(section);
      });
      grid.dataset.corralonProviderLayout = '1';
    }
    if (!modal.dataset.corralonProviderTabOrder) {
      modal.dataset.corralonProviderTabOrder = '1';
      modal.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
        const orderedKeys = [...fieldGroups.general, ...fieldGroups.commercial, ...fieldGroups.notes];
        const controls = orderedKeys.map((key) => resolve(fields[key], modal));
        const footerButtons = [...(actions?.querySelectorAll('button,[href],[tabindex]') || [])];
        const headerButtons = [...(head?.querySelectorAll('button,[href],[tabindex]') || [])];
        const isAvailable = (control) => {
          if (!control || control.disabled || control.hidden || control.tabIndex < 0) return false;
          if (control.closest('.hidden,.provider-hidden,[hidden]')) return false;
          const style = getComputedStyle(control);
          return style.display !== 'none' && style.visibility !== 'hidden';
        };
        const order = [...controls, ...footerButtons, ...headerButtons].filter(isAvailable);
        if (!order.length) return;
        const current = order.indexOf(document.activeElement);
        const nextIndex = current < 0
          ? (event.shiftKey ? order.length - 1 : 0)
          : (current + (event.shiftKey ? -1 : 1) + order.length) % order.length;
        event.preventDefault();
        event.stopImmediatePropagation();
        const next = order[nextIndex];
        next.focus({ preventScroll: true });
        if (next.matches('input:not([type="checkbox"]),textarea')) next.select?.();
      }, true);
    }
    const subtitle = head?.querySelector('.corralon-provider-editor-subtitle');
    return {
      setIdentity(name, id, isNew = false) {
        if (!subtitle) return;
        subtitle.textContent = isNew ? 'Alta de nuevo proveedor' : [name, id ? `ID ${id}` : ''].filter(Boolean).join(' · ');
      }
    };
  }

  const NEW_ARTICLES_IMPORTER = (() => {
    const ID_SEQUENCE_KEY = 'corralon_new_articles_access_max_v1';
    let state = null;
    let returnFocus = null;
    let pointerCell = null;

    function readImportedMax() {
      try {
        return Math.max(0, Number(localStorage.getItem(ID_SEQUENCE_KEY)) || 0);
      } catch (_) {
        return 0;
      }
    }

    function saveImportedMax(value) {
      const nextMax = Math.max(readImportedMax(), Number(value) || 0);
      if (!nextMax) return;
      try { localStorage.setItem(ID_SEQUENCE_KEY, String(nextMax)); }
      catch (_) {}
    }

    function idBaseForIndex(indexMax) {
      const importedMax = readImportedMax();
      if (indexMax >= importedMax) {
        try { localStorage.removeItem(ID_SEQUENCE_KEY); }
        catch (_) {}
        return indexMax;
      }
      return importedMax;
    }

    function text(value) {
      return String(value ?? '').trim();
    }

    function normalized(value) {
      return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
    }

    function escape(value) {
      return text(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    }

    function field(source, names) {
      if (!source || typeof source !== 'object') return '';
      const wanted = names.map(normalized);
      for (const [key, value] of Object.entries(source)) {
        if (wanted.includes(normalized(key)) && value !== null && value !== undefined && text(value) !== '') return value;
      }
      const nested = source.source_rows || source.sourceRows;
      if (Array.isArray(nested)) {
        for (const row of nested) {
          const value = field(row, names);
          if (value !== '') return value;
        }
      }
      return '';
    }

    function catalogCode(row) {
      const digits = text(field(row, ['codigo', 'idart', 'id_art', 'IDArt'])).replace(/\D/g, '');
      return digits ? digits.padStart(6, '0') : '';
    }

    function catalogProviderId(row) {
      return text(field(row, ['id_proveedor', 'idProveedor', 'IDProveedor']));
    }

    function catalogProviderName(row) {
      return text(field(row, ['proveedor', 'Proveedores_Proveedor']));
    }

    function catalogRubroId(row) {
      const value = Number(String(field(row, ['id_rubro', 'idRubro', 'IDRubro'])).replace(/[^0-9-]/g, ''));
      return Number.isInteger(value) && value > 0 ? value : 0;
    }

    function catalogRubroName(row) {
      return text(field(row, ['rubro', 'Rubros_Descripción', 'rubro_descripcion']));
    }

    function providerMatches(row, provider) {
      const providerId = text(provider?.id_proveedor || provider?.idProveedor);
      const rowId = catalogProviderId(row);
      if (providerId && rowId) return providerId === rowId;
      return normalized(catalogProviderName(row)) === normalized(provider?.proveedor || provider?.nombre);
    }

    function formatId(value) {
      return String(Math.max(0, Math.trunc(Number(value) || 0))).padStart(6, '0');
    }

    function rubros(catalog) {
      const result = new Map();
      catalog.forEach((row) => {
        const id = catalogRubroId(row);
        const name = catalogRubroName(row);
        if (id && name && !result.has(id)) result.set(id, name);
      });
      return [...result].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity:'base' }));
    }

    function defaultRubro(catalog, provider) {
      const counts = new Map();
      catalog.forEach((row) => {
        if (!providerMatches(row, provider)) return;
        const id = catalogRubroId(row);
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
      });
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
    }

    function rubroName(id) {
      return state?.rubros?.find((item) => Number(item.id) === Number(id))?.name || '';
    }

    function rubroFromText(value) {
      const wanted = normalized(value);
      return state?.rubros?.find((item) => normalized(item.name) === wanted) || null;
    }

    function closeRubroMenus(except = null) {
      document.querySelectorAll('#corralonNewArticlesBackdrop .corralon-new-rubro-menu.open').forEach((menu) => {
        if (menu !== except) menu.classList.remove('open');
      });
    }

    function showRubroMenu(input, showAll = false) {
      const combo = input?.closest('.corralon-new-rubro-combo');
      const menu = combo?.querySelector('.corralon-new-rubro-menu');
      if (!menu || !state) return;
      const query = normalized(input.value);
      const matches = state.rubros.filter((item) => showAll || !query || normalized(item.name).includes(query)).slice(0, 100);
      menu.innerHTML = matches.map((item, index) => `<div class="corralon-new-rubro-option${index === 0 ? ' active' : ''}" data-new-rubro-id="${item.id}">${escape(item.name)}</div>`).join('') || '<div class="corralon-new-rubro-option">Sin coincidencias</div>';
      menu.dataset.activeIndex = matches.length ? '0' : '-1';
      const rect = input.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 2}px`;
      menu.style.width = `${Math.max(rect.width, 210)}px`;
      closeRubroMenus(menu);
      menu.classList.add('open');
    }

    function chooseRubro(input, option) {
      const rowElement = input?.closest('[data-new-articles-index]');
      const row = state?.rows?.[Number(rowElement?.dataset.newArticlesIndex)];
      const id = Number(option?.dataset?.newRubroId || 0);
      const selected = state?.rubros?.find((item) => item.id === id);
      if (!row || !selected) return false;
      row.idRubro = selected.id;
      row.rubroText = selected.name;
      input.value = selected.name;
      closeRubroMenus();
      state.serverError = '';
      updateValidation();
      return true;
    }

    function restoreFocusedRow(event) {
      if (!state || state.activeRowIndex === null || !state.rowSnapshot) return false;
      const index = state.activeRowIndex;
      const col = Number(event.target?.dataset?.newArticlesCol);
      state.rows[index] = { ...state.rowSnapshot, errors:[] };
      state.rowSnapshot = { ...state.rows[index], errors:[] };
      state.serverError = '';
      render();
      requestAnimationFrame(() => {
        focusImporterCell(importerCellAt(index, Number.isInteger(col) ? col : 2));
      });
      return true;
    }

    function importerBackdrop() {
      return document.getElementById('corralonNewArticlesBackdrop');
    }

    function importerRows() {
      return [...(importerBackdrop()?.querySelectorAll('[data-new-articles-index]') || [])];
    }

    function importerCells(rowElement = null) {
      const root = rowElement || importerBackdrop();
      return [...(root?.querySelectorAll('[data-new-articles-cell]') || [])].filter((control) => {
        if (control.disabled || control.hidden) return false;
        const style = getComputedStyle(control);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    }

    function importerCellPosition(control) {
      const rowElement = control?.closest('[data-new-articles-index]');
      return {
        row:Number(rowElement?.dataset.newArticlesIndex),
        col:Number(control?.dataset.newArticlesCol)
      };
    }

    function importerCellAt(row, col) {
      return importerBackdrop()?.querySelector(`[data-new-articles-index="${row}"] [data-new-articles-cell][data-new-articles-col="${col}"]`) || null;
    }

    function selectedImporterRows() {
      if (!state) return new Set();
      if (!(state.selectedRows instanceof Set)) state.selectedRows = new Set();
      return state.selectedRows;
    }

    function repaintImporterSelection() {
      const selected = selectedImporterRows();
      importerRows().forEach((rowElement) => {
        rowElement.classList.toggle('selected-row', selected.has(Number(rowElement.dataset.newArticlesIndex)));
      });
    }

    function selectImporterRow(index, options = {}) {
      if (!state?.rows?.[index]) return false;
      const selected = selectedImporterRows();
      const multi = Boolean(options.ctrlKey || options.metaKey);
      const range = Boolean(options.shiftKey);
      if (range && Number.isInteger(state.rowAnchor)) {
        if (!multi) selected.clear();
        const from = Math.min(state.rowAnchor, index);
        const to = Math.max(state.rowAnchor, index);
        for (let row = from; row <= to; row += 1) selected.add(row);
      } else if (multi) {
        if (selected.has(index)) selected.delete(index); else selected.add(index);
        state.rowAnchor = index;
      } else {
        selected.clear();
        selected.add(index);
        state.rowAnchor = index;
      }
      repaintImporterSelection();
      return true;
    }

    function isImporterTextControl(control) {
      return control?.matches?.('input:not([type="checkbox"]):not([type="radio"]),textarea') || false;
    }

    function importerTextFullySelected(control) {
      if (!isImporterTextControl(control)) return true;
      const length = String(control.value || '').length;
      return control.selectionStart === 0 && control.selectionEnd === length;
    }

    function importerCanMoveHorizontally(control, direction) {
      if (!isImporterTextControl(control) || control.readOnly || importerTextFullySelected(control)) return true;
      const start = Number(control.selectionStart ?? 0);
      const end = Number(control.selectionEnd ?? start);
      if (start !== end) return false;
      return direction < 0 ? start === 0 : end === String(control.value || '').length;
    }

    function focusImporterCell(control, options = {}) {
      if (!control) return false;
      const position = importerCellPosition(control);
      if (Number.isInteger(position.row)) selectImporterRow(position.row);
      importerBackdrop()?.querySelectorAll('.corralon-new-cell-editing').forEach((item) => item.classList.remove('corralon-new-cell-editing'));
      control.focus({ preventScroll:true });
      if (options.select !== false && isImporterTextControl(control)) control.select?.();
      control.scrollIntoView({ block:'nearest', inline:'nearest' });
      return true;
    }

    function commitImporterCell(control) {
      if (!control?.dataset?.newArticlesField || control.readOnly || control.disabled) return;
      control.dispatchEvent(new Event('change', { bubbles:true }));
    }

    function focusImporterFooter(direction = 1) {
      const backdrop = importerBackdrop();
      const controls = [
        backdrop?.querySelector('[data-new-articles-head-close]'),
        ...importerCells(),
        backdrop?.querySelector('[data-new-articles-cancel]'),
        backdrop?.querySelector('[data-new-articles-import]')
      ].filter((control) => control && !control.disabled && control.offsetParent !== null);
      if (!controls.length) return false;
      const current = controls.indexOf(document.activeElement);
      const next = current < 0
        ? (direction < 0 ? controls.at(-1) : controls[0])
        : controls[(current + direction + controls.length) % controls.length];
      if (next?.matches?.('[data-new-articles-cell]')) return focusImporterCell(next);
      next?.focus({ preventScroll:true });
      return Boolean(next);
    }

    function moveImporterCell(control, key, backwards = false, ctrl = false) {
      const position = importerCellPosition(control);
      const rows = importerRows();
      const rowElement = control?.closest('[data-new-articles-index]');
      const rowCells = importerCells(rowElement);
      if (!Number.isInteger(position.row) || !Number.isInteger(position.col) || !rowCells.length) return false;
      let target = null;
      if (key === 'Enter' || key === 'Tab') {
        const all = importerCells();
        const current = all.indexOf(control);
        target = all[current + (backwards ? -1 : 1)] || null;
        if (!target) return focusImporterFooter(backwards ? -1 : 1);
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        const direction = key === 'ArrowUp' ? -1 : 1;
        const targetRow = ctrl ? (direction < 0 ? 0 : rows.length - 1) : position.row + direction;
        target = importerCellAt(targetRow, position.col);
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const direction = key === 'ArrowLeft' ? -1 : 1;
        if (!importerCanMoveHorizontally(control, direction)) return false;
        const targetCol = ctrl
          ? Number((direction < 0 ? rowCells[0] : rowCells.at(-1))?.dataset.newArticlesCol)
          : position.col + direction;
        target = importerCellAt(position.row, targetCol);
      }
      return focusImporterCell(target);
    }

    function deleteSelectedImporterRows() {
      if (!state || state.importing) return false;
      const selected = [...selectedImporterRows()].filter((index) => state.rows[index]).sort((a, b) => b - a);
      if (!selected.length) return false;
      const nextIndex = Math.min(selected.at(-1), Math.max(0, state.rows.length - selected.length - 1));
      selected.forEach((index) => state.rows.splice(index, 1));
      state.selectedRows.clear();
      state.rowAnchor = null;
      state.activeRowIndex = null;
      state.rowSnapshot = null;
      state.serverError = '';
      render();
      requestAnimationFrame(() => focusImporterCell(importerCellAt(nextIndex, 0)));
      return true;
    }

    function handleImporterTableKey(event) {
      const control = event.target.closest('[data-new-articles-cell]');
      if (!control) return false;
      if (event.key === 'Delete' && selectedImporterRows().size) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return deleteSelectedImporterRows();
      }
      if (event.key === 'F2' && isImporterTextControl(control)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (importerTextFullySelected(control)) {
          const end = String(control.value || '').length;
          control.setSelectionRange?.(end, end);
          control.classList.add('corralon-new-cell-editing');
        } else {
          control.select?.();
          control.classList.remove('corralon-new-cell-editing');
        }
        return true;
      }
      if (event.key === 'F4' && control.matches('select')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (typeof control.showPicker === 'function') control.showPicker(); else control.click();
        return true;
      }
      const navigationKeys = ['Enter','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
      if (!navigationKeys.includes(event.key)) return false;
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
          !importerCanMoveHorizontally(control, event.key === 'ArrowLeft' ? -1 : 1)) return false;
      commitImporterCell(control);
      moveImporterCell(control, event.key, event.shiftKey, event.ctrlKey || event.metaKey);
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }

    function bindFieldFunctions(backdrop) {
      if (backdrop.dataset.functionsBound === '1') return;
      backdrop.dataset.functionsBound = '1';
      backdrop.addEventListener('focusin', (event) => {
        const fieldControl = event.target.closest('[data-new-articles-cell]');
        const rowElement = fieldControl?.closest('[data-new-articles-index]');
        const index = Number(rowElement?.dataset.newArticlesIndex);
        if (!fieldControl || !Number.isInteger(index) || !state?.rows?.[index]) return;
        if (state.activeRowIndex !== index) {
          state.activeRowIndex = index;
          state.rowSnapshot = { ...state.rows[index], errors:[...(state.rows[index].errors || [])] };
        }
        if (pointerCell !== fieldControl) {
          selectImporterRow(index);
          fieldControl.classList.remove('corralon-new-cell-editing');
          if (isImporterTextControl(fieldControl)) fieldControl.select?.();
        }
      });
      backdrop.addEventListener('focusout', (event) => {
        event.target.closest?.('[data-new-articles-cell]')?.classList.remove('corralon-new-cell-editing');
        const rowElement = event.target.closest('[data-new-articles-index]');
        if (!rowElement) return;
        const leavingIndex = Number(rowElement.dataset.newArticlesIndex);
        setTimeout(() => {
          const activeRow = document.activeElement?.closest?.('[data-new-articles-index]');
          const activeIndex = Number(activeRow?.dataset?.newArticlesIndex);
          if (activeIndex !== leavingIndex && state?.activeRowIndex === leavingIndex) {
            state.activeRowIndex = null;
            state.rowSnapshot = null;
          }
        }, 0);
      });
      backdrop.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        const rowElement = event.target.closest('[data-new-articles-index]');
        const rowIndex = Number(rowElement?.dataset.newArticlesIndex);
        if (Number.isInteger(rowIndex) && state?.rows?.[rowIndex]) {
          selectImporterRow(rowIndex, event);
        }
        const toggle = event.target.closest('[data-new-rubro-toggle]');
        if (toggle) {
          event.preventDefault();
          event.stopPropagation();
          const input = toggle.closest('.corralon-new-rubro-combo')?.querySelector('[data-new-articles-field="rubroText"]');
          if (!input) return;
          input.focus();
          const menu = toggle.closest('.corralon-new-rubro-combo').querySelector('.corralon-new-rubro-menu');
          if (menu.classList.contains('open')) closeRubroMenus(); else showRubroMenu(input, true);
          return;
        }
        const option = event.target.closest('[data-new-rubro-id]');
        if (option) {
          event.preventDefault();
          const input = option.closest('.corralon-new-rubro-combo')?.querySelector('[data-new-articles-field="rubroText"]');
          chooseRubro(input, option);
          return;
        }
        const cell = event.target.closest('[data-new-articles-cell]');
        if (cell && !cell.disabled) {
          pointerCell = cell;
          if (document.activeElement !== cell) {
            event.preventDefault();
            cell.classList.remove('corralon-new-cell-editing');
            cell.focus({ preventScroll:true });
            if (isImporterTextControl(cell)) cell.select?.();
          } else if (isImporterTextControl(cell) && !cell.readOnly) {
            cell.classList.add('corralon-new-cell-editing');
          }
          setTimeout(() => { if (pointerCell === cell) pointerCell = null; }, 0);
        }
      });
      backdrop.addEventListener('keydown', (event) => {
        const input = event.target.closest('[data-new-articles-field="rubroText"]');
        if (event.key === 'Escape' && event.target.closest('[data-new-articles-cell]')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeRubroMenus();
          restoreFocusedRow(event);
          return;
        }
        if (input) {
          const menu = input.closest('.corralon-new-rubro-combo')?.querySelector('.corralon-new-rubro-menu');
          if (event.key === 'F4') {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (menu.classList.contains('open')) closeRubroMenus(); else showRubroMenu(input, true);
            return;
          }
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && menu.classList.contains('open')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const options = [...menu.querySelectorAll('[data-new-rubro-id]')];
            if (!options.length) return;
            let index = Number(menu.dataset.activeIndex || 0) + (event.key === 'ArrowDown' ? 1 : -1);
            index = Math.max(0, Math.min(options.length - 1, index));
            menu.dataset.activeIndex = String(index);
            options.forEach((option, optionIndex) => option.classList.toggle('active', optionIndex === index));
            options[index].scrollIntoView({ block:'nearest' });
            return;
          }
          if (event.key === 'Enter' && menu.classList.contains('open')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!input.value.trim()) closeRubroMenus();
            else {
              const options = [...menu.querySelectorAll('[data-new-rubro-id]')];
              chooseRubro(input, options[Math.max(0, Number(menu.dataset.activeIndex || 0))]);
            }
            commitImporterCell(input);
            moveImporterCell(input, 'Enter');
            return;
          }
        }
        if (handleImporterTableKey(event)) return;
        if (event.key === 'Tab' && event.target.closest('.corralon-new-articles-modal')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          focusImporterFooter(event.shiftKey ? -1 : 1);
        }
      });
      backdrop.addEventListener('input', (event) => {
        const input = event.target.closest('[data-new-articles-field="rubroText"]');
        if (input) showRubroMenu(input, false);
      });
      document.addEventListener('mousedown', (event) => {
        if (!event.target.closest('.corralon-new-rubro-combo')) closeRubroMenus();
      }, true);
      const fx = window.CorralonFunciones;
      fx?.bindLiveLocaleNumber?.({ root:backdrop, selector:'[data-new-articles-field="margen"]', decimals:2, suffix:' %' });
    }

    function ensureUi() {
      let backdrop = document.getElementById('corralonNewArticlesBackdrop');
      if (backdrop) return backdrop;
      const style = document.createElement('style');
      style.id = 'corralonNewArticlesStyle';
      style.textContent = `
        #corralonNewArticlesBackdrop{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(17,17,17,.66);backdrop-filter:blur(3px);font-family:Barlow,Arial,sans-serif}
        #corralonNewArticlesBackdrop.open{display:flex}
        .corralon-new-articles-modal{width:min(1420px,97vw);max-height:92dvh;display:flex;flex-direction:column;background:var(--corralon-white);border:1px solid rgba(255,255,255,.75);border-radius:20px;box-shadow:0 28px 90px rgba(0,0,0,.38);overflow:hidden;color:var(--corralon-text)}
        .corralon-new-articles-head{position:relative;display:flex;align-items:center;gap:14px;padding:17px 20px 15px;border-bottom:1px solid var(--corralon-line);background:linear-gradient(180deg,#fff 0%,#fbfbfa 100%)}.corralon-new-articles-head:before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--corralon-red)}.corralon-new-articles-title-copy{display:grid;gap:2px}.corralon-new-articles-head h2{margin:0;color:var(--corralon-black);font:900 30px/1 'Barlow Condensed',Barlow,sans-serif;letter-spacing:.1px}.corralon-new-articles-head span{color:var(--corralon-muted);font-size:14px;font-weight:700}.corralon-new-articles-head button{margin-left:auto;width:36px;height:36px;padding:0!important;border:1px solid var(--corralon-line)!important;border-radius:10px!important;background:var(--corralon-white)!important;color:var(--corralon-black)!important;box-shadow:0 2px 7px rgba(0,0,0,.07)!important;font:800 20px/1 Barlow!important}.corralon-new-articles-head button:hover{border-color:var(--corralon-red)!important;color:var(--corralon-red)!important;background:#fff5f5!important}
        .corralon-new-articles-summary{display:grid;grid-template-columns:minmax(260px,2fr) repeat(3,minmax(140px,1fr));gap:9px;padding:11px 16px 12px;background:#f5f5f3;border-bottom:1px solid var(--corralon-line)}.corralon-new-articles-summary label{display:grid;gap:4px;padding:8px 10px 9px;border:1px solid #e1e1de;border-radius:10px;background:var(--corralon-white);color:var(--corralon-muted);font:800 11px/1 Barlow;text-transform:uppercase;letter-spacing:.45px}.corralon-new-articles-summary input{box-sizing:border-box;width:100%;height:22px;padding:0;border:0!important;background:transparent!important;box-shadow:none!important;color:var(--corralon-black)!important;font:800 16px/1.1 Barlow,Arial}
        .corralon-new-articles-table-wrap{min-height:68px;max-height:52dvh;overflow:auto;background:#fff}.corralon-new-articles-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}.corralon-new-articles-table th{position:sticky;top:0;z-index:2;height:34px;padding:6px 8px;border-right:1px solid #ddd;border-bottom:1px solid #c8c8c5;background:#e9e9e6;color:#292929;font:900 14px/1 'Barlow Condensed',Barlow;text-align:left;text-transform:uppercase;letter-spacing:.3px}.corralon-new-articles-table th:last-child,.corralon-new-articles-table td:last-child{border-right:0}.corralon-new-articles-table td{height:39px;padding:4px 6px;border-right:1px solid #e5e5e2;border-bottom:1px solid #e5e5e2;background:#fff;font:700 14px Barlow,Arial}.corralon-new-articles-table tbody tr:nth-child(even) td{background:#f8f8f6}.corralon-new-articles-table tbody tr:hover td{background:#f1f1ee}.corralon-new-articles-table tbody tr.has-error td{background:#fff0f2!important}.corralon-new-articles-table input,.corralon-new-articles-table select{box-sizing:border-box;width:100%;height:31px;padding:4px 8px;border:1px solid #c9c9c5;border-radius:7px;background:#fff;font:700 14px Barlow,Arial;transition:border-color .15s,box-shadow .15s}.corralon-new-articles-table input:focus,.corralon-new-articles-table select:focus{border-color:#777!important;box-shadow:0 0 0 3px rgba(17,17,17,.08)!important;outline:0}.corralon-new-articles-table input[readonly]{background:#f0f0ed!important;border-color:transparent!important;color:#4f4f4b!important;box-shadow:none!important}.corralon-new-articles-table .num{text-align:right;font-variant-numeric:tabular-nums}.corralon-new-articles-table .id{width:88px}.corralon-new-articles-table .code{width:135px}.corralon-new-articles-table .description{width:auto}.corralon-new-articles-table .rubro{width:225px}.corralon-new-articles-table .iva{width:95px}.corralon-new-articles-table .margin{width:100px}.corralon-new-articles-table .cost{width:125px}.corralon-new-articles-table .remove{width:46px}.corralon-new-articles-remove{display:grid!important;place-items:center;width:29px!important;height:29px!important;margin:auto;padding:0!important;border:1px solid transparent!important;border-radius:8px!important;background:transparent!important;color:#d10d13!important;font:900 21px/1 Barlow!important;box-shadow:none!important}.corralon-new-articles-remove:hover{border-color:#ffc8ca!important;background:#fff0f1!important}
        .corralon-new-articles-table tbody tr.selected-row td{background:var(--corralon-selection,#ded6fb)!important;box-shadow:inset 0 1px 0 rgba(108,79,199,.13),inset 0 -1px 0 rgba(108,79,199,.13)}.corralon-new-articles-table tbody tr.selected-row [data-new-articles-cell]:not(:focus){background:transparent!important}.corralon-new-articles-table [data-new-articles-cell]{cursor:default;caret-color:transparent}.corralon-new-articles-table [data-new-articles-cell].corralon-new-cell-editing{cursor:text;caret-color:auto}.corralon-new-articles-table tbody tr.selected-row [data-new-articles-cell]:focus{background:#fff!important}
        .corralon-new-rubro-combo{position:relative}.corralon-new-rubro-input{padding-right:27px!important}.corralon-new-rubro-toggle{position:absolute;right:1px;top:1px;display:none;width:25px!important;height:25px!important;padding:0!important;border:0!important;border-radius:4px!important;background:var(--corralon-soft-2)!important;box-shadow:none!important;font-size:12px!important}.corralon-new-rubro-combo:hover .corralon-new-rubro-toggle,.corralon-new-rubro-combo:focus-within .corralon-new-rubro-toggle{display:block}.corralon-new-rubro-menu{position:fixed;z-index:10070;display:none;max-height:260px;overflow:auto;border:1px solid var(--corralon-line-strong);border-radius:7px;background:var(--corralon-white);box-shadow:var(--corralon-shadow)}.corralon-new-rubro-menu.open{display:block}.corralon-new-rubro-option{padding:6px 9px;cursor:pointer;white-space:nowrap;font-weight:700}.corralon-new-rubro-option:hover,.corralon-new-rubro-option.active{background:var(--corralon-selection)}
        .corralon-new-articles-validation{min-height:42px;box-sizing:border-box;padding:11px 18px;border-top:1px solid var(--corralon-line);background:#fff8df;color:#705600;font-size:14px;font-weight:800}.corralon-new-articles-validation.ok{background:#e9f7ed;color:#08733a}.corralon-new-articles-validation.error{background:#fff0f2;color:#b10f31}.corralon-new-articles-actions{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid var(--corralon-line);background:#fafaf8}.corralon-new-articles-count{margin-right:auto;color:var(--corralon-muted);font-size:14px;font-weight:800}.corralon-new-articles-actions button{min-height:36px;padding:7px 15px!important;border:1px solid var(--corralon-line-strong)!important;border-radius:9px!important;background:#fff!important;color:var(--corralon-black)!important;font:800 14px Barlow!important;box-shadow:0 2px 6px rgba(0,0,0,.06)!important}.corralon-new-articles-actions button:hover{background:#f1f1ef!important}.corralon-new-articles-primary{min-width:158px;background:linear-gradient(180deg,var(--corralon-red),var(--corralon-red-dark))!important;border-color:var(--corralon-red)!important;color:var(--corralon-white)!important;box-shadow:0 7px 16px rgba(201,0,6,.22)!important}.corralon-new-articles-primary:hover{background:linear-gradient(180deg,#ff2429,var(--corralon-red-deep))!important}
        @media(max-width:900px){#corralonNewArticlesBackdrop{padding:0;backdrop-filter:none}.corralon-new-articles-modal{width:100vw;height:100dvh;max-height:100dvh;border-radius:0}.corralon-new-articles-head{padding:13px 14px}.corralon-new-articles-head h2{font-size:25px}.corralon-new-articles-head span{font-size:12px}.corralon-new-articles-summary{grid-template-columns:1fr 1fr;padding:8px}.corralon-new-articles-table-wrap{max-height:none;flex:1}.corralon-new-articles-table{min-width:1050px}.corralon-new-articles-actions{padding:9px}.corralon-new-articles-count{display:none}}
      `;
      document.head.appendChild(style);
      backdrop = document.createElement('div');
      backdrop.id = 'corralonNewArticlesBackdrop';
      backdrop.innerHTML = `<section class="corralon-new-articles-modal" role="dialog" aria-modal="true" aria-labelledby="corralonNewArticlesTitle">
        <div class="corralon-new-articles-head"><div class="corralon-new-articles-title-copy"><h2 id="corralonNewArticlesTitle">Importar artículos nuevos</h2><span>Revisá los datos antes de enviarlos a Access.</span></div><button type="button" data-new-articles-close data-new-articles-head-close title="Cerrar" aria-label="Cerrar">×</button></div>
        <div class="corralon-new-articles-summary"><label>Proveedor<input data-new-articles-provider readonly tabindex="-1"></label><label>ID proveedor<input data-new-articles-provider-id readonly tabindex="-1"></label><label>Moneda<input value="1 · Pesos" readonly tabindex="-1"></label><label>Primer IDArt<input data-new-articles-first-id readonly tabindex="-1"></label></div>
        <div class="corralon-new-articles-table-wrap"><table class="corralon-new-articles-table"><thead><tr><th class="id">IDArt</th><th class="code">Cód. proveedor</th><th class="description">Descripción</th><th class="rubro">Rubro</th><th class="iva">IVA</th><th class="margin">Margen</th><th class="cost num">Costo</th><th class="remove"></th></tr></thead><tbody data-new-articles-body></tbody></table></div>
        <div class="corralon-new-articles-validation" data-new-articles-validation>Preparando artículos...</div>
        <div class="corralon-new-articles-actions"><span class="corralon-new-articles-count" data-new-articles-count></span><button type="button" data-new-articles-close data-new-articles-cancel>Cancelar</button><button class="corralon-new-articles-primary" type="button" data-new-articles-import>Importar en Access</button></div>
      </section>`;
      document.body.appendChild(backdrop);
      bindFieldFunctions(backdrop);
      backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
      backdrop.addEventListener('click', (event) => {
        if (event.target.closest('[data-new-articles-close]')) close();
        const remove = event.target.closest('[data-new-articles-remove]');
        if (remove && state && !state.importing) {
          const index = Number(remove.dataset.newArticlesRemove);
          state.rows.splice(index, 1);
          state.selectedRows?.clear();
          state.rowAnchor = null;
          state.activeRowIndex = null;
          state.rowSnapshot = null;
          state.serverError = '';
          render();
          requestAnimationFrame(() => focusImporterCell(importerCellAt(Math.min(index, state.rows.length - 1), 0)));
        }
        if (event.target.closest('[data-new-articles-import]')) importToAccess();
      });
      backdrop.addEventListener('input', updateField);
      backdrop.addEventListener('change', updateField);
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && backdrop.classList.contains('open')) {
          if (event.target.closest?.('[data-new-articles-field]')) return;
          event.preventDefault(); event.stopPropagation(); close();
        }
      }, true);
      return backdrop;
    }

    function assignIds() {
      if (!state) return;
      const base = Number(state.idBase ?? state.indexMax) || 0;
      state.rows.forEach((row, index) => { row.idArt = formatId(base + index + 1); });
    }

    function validate() {
      if (!state) return ['No hay una importación preparada.'];
      const errors = [];
      const batchIds = new Map();
      const batchCodes = new Map();
      const batchDescriptions = new Map();
      if (!text(state.provider.id_proveedor || state.provider.idProveedor)) errors.push('Falta el proveedor.');
      if (!state.rows.length) errors.push('No quedan artículos para importar.');
      if (!state.rubros.length) errors.push('La lista de Index todavía no contiene IDRubro. Actualizala antes de importar.');
      state.rows.forEach((row, index) => {
        const rowErrors = [];
        const idArt = formatId(row.idArt);
        const code = normalized(row.codigo);
        const description = normalized(row.descripcion);
        if (!/^\d{6}$/.test(text(row.idArt)) || Number(row.idArt) <= 0) rowErrors.push('IDArt inválido');
        else if (state.catalogIds?.has(idArt)) rowErrors.push('IDArt ya existente en Index');
        if (!code) rowErrors.push('falta código de proveedor');
        if (!description) rowErrors.push('falta descripción');
        if (!(Number(row.costo) > 0)) rowErrors.push('costo inválido');
        if (!(Number(row.idRubro) > 0)) rowErrors.push('elegí el rubro');
        if (![0.21, 0.105].includes(Number(row.iva))) rowErrors.push('IVA inválido');
        if (!Number.isFinite(Number(row.margen)) || Number(row.margen) < 0) rowErrors.push('margen inválido');
        if (/^\d{6}$/.test(idArt)) { if (batchIds.has(idArt)) rowErrors.push(`IDArt repetido con fila ${batchIds.get(idArt) + 1}`); else batchIds.set(idArt, index); }
        if (code) { if (batchCodes.has(code)) rowErrors.push(`código repetido con fila ${batchCodes.get(code) + 1}`); else batchCodes.set(code, index); }
        if (description) { if (batchDescriptions.has(description)) rowErrors.push(`descripción repetida con fila ${batchDescriptions.get(description) + 1}`); else batchDescriptions.set(description, index); }
        row.errors = rowErrors;
        if (rowErrors.length) errors.push(`Fila ${index + 1}: ${rowErrors.join(', ')}.`);
      });
      if (state.serverError) errors.unshift(state.serverError);
      return errors;
    }

    function render() {
      const backdrop = ensureUi();
      if (!state) return;
      const body = backdrop.querySelector('[data-new-articles-body]');
      state.selectedRows = new Set([...selectedImporterRows()].filter((index) => state.rows[index]));
      body.innerHTML = state.rows.map((row, index) => {
        const rubroText = row.rubroText || rubroName(row.idRubro);
        const selectedClass = state.selectedRows.has(index) ? ' class="selected-row"' : '';
        return `<tr${selectedClass} data-new-articles-index="${index}">
          <td><input data-new-articles-cell data-new-articles-col="0" data-row="${index}" data-col="0" data-new-articles-field="idArt" inputmode="numeric" maxlength="6" value="${escape(row.idArt)}" autocomplete="off"></td>
          <td><input data-new-articles-cell data-new-articles-col="1" data-row="${index}" data-col="1" value="${escape(row.codigo)}" readonly></td>
          <td><input data-new-articles-cell data-new-articles-col="2" data-row="${index}" data-col="2" data-new-articles-field="descripcion" value="${escape(row.descripcion)}" autocomplete="off"></td>
          <td><div class="corralon-new-rubro-combo"><input class="corralon-new-rubro-input" data-new-articles-cell data-new-articles-col="3" data-row="${index}" data-col="3" data-new-articles-field="rubroText" value="${escape(rubroText)}" autocomplete="off"><button type="button" class="corralon-new-rubro-toggle" data-new-rubro-toggle tabindex="-1" aria-label="Abrir rubros">▼</button><div class="corralon-new-rubro-menu"></div></div></td>
          <td><select data-new-articles-cell data-new-articles-col="4" data-row="${index}" data-col="4" data-new-articles-field="iva"><option value="0.21"${Number(row.iva) === .21 ? ' selected' : ''}>21 %</option><option value="0.105"${Number(row.iva) === .105 ? ' selected' : ''}>10,5 %</option></select></td>
          <td><input class="num" data-new-articles-cell data-new-articles-col="5" data-row="${index}" data-col="5" data-new-articles-field="margen" inputmode="decimal" value="${Number(row.margen || 0).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })} %"></td>
          <td><input class="num" data-new-articles-cell data-new-articles-col="6" data-row="${index}" data-col="6" value="${escape(money(row.costo))}" readonly></td>
          <td><button class="corralon-new-articles-remove" type="button" data-new-articles-remove="${index}" tabindex="-1" title="Quitar">×</button></td>
        </tr>`;
      }).join('');
      backdrop.querySelector('[data-new-articles-first-id]').value = state.rows[0]?.idArt || '';
      updateValidation();
      repaintImporterSelection();
    }

    function updateField(event) {
      const control = event.target.closest('[data-new-articles-field]');
      const rowElement = event.target.closest('[data-new-articles-index]');
      const row = state?.rows?.[Number(rowElement?.dataset.newArticlesIndex)];
      if (!control || !row) return;
      const name = control.dataset.newArticlesField;
      if (name === 'idArt') {
        const digits = String(control.value || '').replace(/\D/g, '').slice(0, 6);
        row.idArt = event.type === 'change' && digits ? formatId(digits) : digits;
        state.idsTouched = true;
        if (event.type === 'change') control.value = row.idArt;
      }
      if (name === 'descripcion') row.descripcion = control.value;
      if (name === 'rubroText') {
        row.rubroText = control.value;
        row.idRubro = rubroFromText(control.value)?.id || 0;
      }
      if (name === 'iva') row.iva = Number(control.value) || 0;
      if (name === 'margen') {
        row.margen = parseFlexibleNumber(control.value);
        if (event.type === 'change') control.value = `${Number(row.margen || 0).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })} %`;
      }
      state.serverError = '';
      updateValidation();
    }

    function updateValidation() {
      const backdrop = ensureUi();
      const errors = validate();
      backdrop.querySelectorAll('[data-new-articles-index]').forEach((tr) => {
        const row = state?.rows?.[Number(tr.dataset.newArticlesIndex)];
        tr.classList.toggle('has-error', Boolean(row?.errors?.length));
        tr.title = row?.errors?.join(' · ') || '';
      });
      backdrop.querySelector('[data-new-articles-count]').textContent = `${state?.rows?.length || 0} artículo${state?.rows?.length === 1 ? '' : 's'} · IDArt máximo de Index: ${formatId(state?.indexMax || 0)}`;
      backdrop.querySelector('[data-new-articles-first-id]').value = state?.rows?.[0]?.idArt || '';
      const validation = backdrop.querySelector('[data-new-articles-validation]');
      validation.className = `corralon-new-articles-validation ${errors.length ? 'error' : 'ok'}`;
      validation.textContent = errors.length ? errors.slice(0, 4).join(' ') : 'Todo listo. La existencia del IDArt, código y descripción se validará directamente en Access al importar.';
      const button = backdrop.querySelector('[data-new-articles-import]');
      button.disabled = Boolean(errors.length) || Boolean(state?.importing);
      return errors;
    }

    async function validateAccessMax() {
      try {
        const response = await fetch(`/api/articulos-nuevos/validate?maxIndex=${encodeURIComponent(state.indexMax)}`, { cache:'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || `Access respondió HTTP ${response.status}`);
        state.serverError = '';
        updateValidation();
        return true;
      } catch (error) {
        state.serverError = `No se puede importar: ${error.message}`;
        updateValidation();
        return false;
      }
    }

    function accessRows() {
      const providerId = Number(state.provider.id_proveedor || state.provider.idProveedor);
      return state.rows.map((row) => {
        const iva = Number(row.iva);
        const cost = Number(row.costo);
        const margin = Number(row.margen || 0) / 100;
        return { id_art:row.idArt, cod_proveedor:row.codigo, articulo:text(row.descripcion).toLocaleUpperCase('es-AR'), precio_costo:Number(cost.toFixed(2)), precio_lista:Number(cost.toFixed(2)), precio_venta:Number((cost * (1 + iva) * (1 + margin)).toFixed(2)), id_proveedor:providerId, id_rubro:Number(row.idRubro), id_moneda:1, nota:'', porc_iva:iva, porc_gan_min:margin, porc_gan_int:margin, porc_gan_may:margin };
      });
    }

    async function importToAccess() {
      if (!state || state.importing || updateValidation().length) return;
      const operationState = state;
      state.importing = true;
      const backdrop = ensureUi();
      const button = backdrop.querySelector('[data-new-articles-import]');
      button.textContent = 'Importando...';
      backdrop.querySelector('[data-new-articles-validation]').textContent = 'Verificando Access y preparando Articulos.xls...';
      closeRubroMenus();
      backdrop.classList.remove('open');
      returnFocus?.focus?.({ preventScroll:true });
      let succeeded = false;
      try {
        if (!window.XLSX) throw new Error('No se pudo cargar el módulo XLSX');
        const importedRows = accessRows();
        const blob = buildNewArticlesXlsBlob(importedRows);
        const response = await fetch(`/api/articulos-nuevos/import?maxIndex=${encodeURIComponent(operationState.indexMax)}`, { method:'POST', body:blob });
        const payload = await response.json().catch(async () => ({ error:await response.text() }));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || `Access respondió HTTP ${response.status}`);
        const importedMax = importedRows.reduce((max, row) => Math.max(max, Number(row.id_art) || 0), 0);
        saveImportedMax(Math.max(Number(payload.access_max_nuevo) || 0, importedMax));
        succeeded = true;
        operationState.options?.showMessage?.('Artículos nuevos importados en Access');
        try { operationState.options?.onImported?.(payload, importedRows); }
        catch (callbackError) { console.warn('La importación terminó, pero falló la actualización visual posterior.', callbackError); }
      } catch (error) {
        const collision = String(error.message || '').match(/El IDArt\s+(\d{1,6})\s+ya existe/i);
        if (collision) {
          const existingId = Number(collision[1]);
          saveImportedMax(existingId);
          operationState.idBase = Math.max(Number(operationState.indexMax) || 0, existingId);
          operationState.idsTouched = false;
          operationState.serverError = '';
          assignIds();
          render();
          operationState.options?.showMessage?.(`El IDArt ${formatId(existingId)} ya existía. Se ajustó desde ${operationState.rows[0]?.idArt || ''}.`);
        } else {
          operationState.serverError = `No se pudo importar: ${error.message}`;
        }
      } finally {
        operationState.importing = false;
        button.textContent = 'Importar en Access';
        if (state !== operationState) return;
        if (succeeded) {
          state = null;
          returnFocus = null;
        } else {
          updateValidation();
          backdrop.classList.add('open');
          requestAnimationFrame(() => focusImporterCell(importerCellAt(0, 0)));
        }
      }
    }

    async function open(options = {}) {
      if (state?.importing) {
        options.showMessage?.('Ya hay una importación de artículos ejecutándose en segundo plano');
        return false;
      }
      const provider = options.provider || {};
      const sourceRows = Array.isArray(options.rows) ? options.rows : [];
      if (!text(provider.id_proveedor || provider.idProveedor)) { options.showMessage?.('Primero elegí un proveedor'); return false; }
      if (!sourceRows.length) { options.showMessage?.('No hay artículos para importar'); return false; }
      returnFocus = options.returnFocus || document.activeElement;
      let catalog = Array.isArray(options.catalogRows) && options.catalogRows.length ? options.catalogRows : null;
      if (!catalog) {
        const progressive = await CATALOG.loadProgressive({ fallback:true });
        catalog = progressive.fromCache && progressive.initialRows.length
          ? progressive.initialRows
          : await progressive.complete;
      }
      // Algunas instalaciones conservaron una cache parcial con un unico
      // rubro. No se usa para importar: se elimina y se baja el catalogo
      // completo una sola vez.
      if (rubros(catalog).length <= 1) {
        await CATALOG.clearCache();
        catalog = await CATALOG.load({ fallback:true });
      }
      const indexMax = catalog.reduce((max, row) => Math.max(max, Number(catalogCode(row)) || 0), 0);
      const idBase = idBaseForIndex(indexMax);
      const rubroList = rubros(catalog);
      const initialRubro = defaultRubro(catalog, provider);
      state = {
        provider,
        indexMax,
        idBase,
        catalogIds:new Set(catalog.map(catalogCode).filter(Boolean)),
        idsTouched:false,
        rubros:rubroList,
        importing:false,
        serverError:'',
        activeRowIndex:null,
        rowSnapshot:null,
        selectedRows:new Set(),
        rowAnchor:null,
        options,
        rows:sourceRows.map((row) => {
          const selectedRubro = Number(row.idRubro || row.id_rubro || initialRubro || 0);
          return { idArt:'', codigo:text(row.codigo || row.cod_proveedor || row.codProveedor), descripcion:text(row.descripcion || row.articulo), costo:Number(row.costo || row.precio_costo || row.precioFinal || 0), idRubro:selectedRubro, rubroText:rubroList.find((item) => item.id === selectedRubro)?.name || '', iva:Number(row.iva || .21), margen:Number(row.margen ?? 30), errors:[] };
        })
      };
      assignIds();
      const backdrop = ensureUi();
      backdrop.querySelector('[data-new-articles-provider]').value = text(provider.proveedor || provider.nombre);
      backdrop.querySelector('[data-new-articles-provider-id]').value = text(provider.id_proveedor || provider.idProveedor);
      render();
      backdrop.classList.add('open');
      requestAnimationFrame(() => focusImporterCell(importerCellAt(0, 0)));
      return true;
    }

    function close() {
      if (state?.importing) return;
      document.getElementById('corralonNewArticlesBackdrop')?.classList.remove('open');
      state = null;
      const target = returnFocus;
      returnFocus = null;
      target?.focus?.({ preventScroll:true });
    }

    return { open, close, isOpen:() => document.getElementById('corralonNewArticlesBackdrop')?.classList.contains('open') || false };
  })();

  const BUDGET_SEARCH = (() => {
    const TABLE = 'presupuestos_web';
    let budgets = [];
    let groups = [];
    let selectedKey = '';
    let returnFocus = null;
    let openOptions = {};
    let uiBound = false;

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const normalizeSearch = (value) => String(value || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const budgetTimestamp = (budget = {}) => {
      const iso = Date.parse(String(budget.fecha_iso || ''));
      if (Number.isFinite(iso)) return iso;
      const parts = String(budget.fecha || '').trim().split(/[\/\-.\s]+/).map(Number);
      if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return 0;
      const isoFormat = parts[0] > 31;
      const baseYear = isoFormat ? parts[0] : parts[2];
      const year = baseYear < 100 ? 2000 + baseYear : baseYear;
      const date = new Date(year, parts[1] - 1, isoFormat ? parts[2] : parts[0]);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    };
    const isRecentBudget = (budget = {}) => {
      const timestamp = budgetTimestamp(budget);
      const limitDate = new Date();
      limitDate.setHours(0, 0, 0, 0);
      limitDate.setDate(limitDate.getDate() - 30);
      return timestamp >= limitDate.getTime();
    };
    const budgetTitle = (budget = {}) => {
      const type = String(budget.tipo || 'Presupuesto web').trim() || 'Presupuesto web';
      const name = String(budget.cliente_nombre || budget.nombre || '').trim();
      return name ? `${type} - ${name}` : type;
    };
    const budgetUser = (budget = {}) => String(
      budget.usuario_nombre || budget.usuario || budget.user_name || budget.creado_por || ''
    ).trim() || 'Sin informar';
    const budgetNote = (budget = {}) => String(
      budget.nota || budget.observaciones || budget.observacion || ''
    ).trim() || 'Sin informar';
    const budgetDate = (budget = {}) => budget.fecha || (budget.fecha_iso
      ? new Date(budget.fecha_iso).toLocaleDateString('es-AR') : '');
    const formatMoney = (value) => `$ ${Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
    const formatQuantity = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString('es-AR', { maximumFractionDigits:3 }) : String(value ?? '');
    };

    function ensureUi() {
      if (!document.getElementById('corralonBudgetSearchStyle')) {
        const style = document.createElement('style');
        style.id = 'corralonBudgetSearchStyle';
        style.textContent = `
          .corralon-budget-search-bg{position:fixed;inset:0;z-index:2147483600;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.58);backdrop-filter:blur(5px)}
          .corralon-budget-search-bg.open{display:flex}
          .corralon-budget-search-modal{width:min(1180px,96vw);height:min(760px,90vh);display:grid;grid-template-rows:auto 1fr;overflow:hidden;border:1px solid #dededb;border-radius:20px;background:#fff;box-shadow:0 28px 80px rgba(0,0,0,.32);font-family:Arial,sans-serif}
          .corralon-budget-search-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #dededb;background:linear-gradient(90deg,#f1f1ef,#fff)}
          .corralon-budget-search-head h2{margin:0;color:#ef1015;font:900 29px 'Barlow Condensed',Arial,sans-serif}
          .corralon-budget-search-close{margin-left:auto;border:1px solid #c9c9c6;border-radius:12px;background:#fff;color:#171717;padding:9px 18px;font:900 18px 'Barlow Condensed',Arial,sans-serif;cursor:pointer}
          .corralon-budget-search-body{min-height:0;display:grid;grid-template-rows:auto auto auto minmax(130px,.8fr) minmax(220px,1.2fr);gap:10px;padding:14px;overflow:hidden}
          .corralon-budget-search-field{overflow:hidden;border:1px solid #c9c9c6;border-radius:14px;background:#fff;box-shadow:0 5px 15px rgba(0,0,0,.08)}
          .corralon-budget-search-field label{display:block;padding:7px 11px 0;color:#666;font:900 16px 'Barlow Condensed',Arial,sans-serif;cursor:pointer}
          .corralon-budget-search-field input{width:100%;height:44px;border:0;outline:0;padding:4px 11px 9px;color:#171717;background:#fff;font:700 23px 'Barlow Condensed',Arial,sans-serif}
          .corralon-budget-search-field:focus-within{border-color:#ef1015;box-shadow:0 0 0 3px rgba(239,16,21,.14)}
          .corralon-budget-search-dates{display:flex;align-items:center;gap:10px}
          .corralon-budget-search-dates>div{display:flex;align-items:center;gap:7px}
          .corralon-budget-search-dates label{color:#555;font:900 16px 'Barlow Condensed',Arial,sans-serif;cursor:pointer}
          .corralon-budget-search-dates input{height:34px;border:1px solid #c9c9c6;border-radius:9px;padding:3px 8px;background:#fff;color:#171717;font:700 14px Arial,sans-serif;outline:0}
          .corralon-budget-search-dates input:focus{border-color:#ef1015;box-shadow:0 0 0 2px rgba(239,16,21,.12)}
          .corralon-budget-search-count{color:#666;font:900 17px 'Barlow Condensed',Arial,sans-serif}
          .corralon-budget-search-results{display:grid;gap:8px;align-content:start;overflow:auto;padding-right:4px}
          .corralon-budget-search-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;min-height:60px;padding:10px 13px;border:1px solid #dededb;border-radius:14px;background:linear-gradient(90deg,#f5f5f3,#fff);cursor:pointer;outline:none}
          .corralon-budget-search-card:hover,.corralon-budget-search-card.active,.corralon-budget-search-card:focus{border-color:#ef1015;background:#fff1f1;box-shadow:0 8px 22px rgba(239,16,21,.13)}
          .corralon-budget-search-card strong{display:block;color:#171717;font:900 22px 'Barlow Condensed',Arial,sans-serif}
          .corralon-budget-search-card span{display:block;margin-top:2px;color:#666;font-size:13px;font-weight:800}
          .corralon-budget-search-card b{color:#ef1015;font:900 20px 'Barlow Condensed',Arial,sans-serif;white-space:nowrap}
          .corralon-budget-search-detail{overflow:auto;border:1px solid #dededb;border-radius:14px;background:#fff}
          .corralon-budget-search-detail-title{padding:9px 12px;border-bottom:1px solid #dededb;background:linear-gradient(90deg,#f1f1ef,#fff);color:#ef1015;font:900 22px 'Barlow Condensed',Arial,sans-serif}
          .corralon-budget-search-meta{display:grid;grid-template-columns:minmax(180px,.35fr) minmax(280px,1fr);gap:0;border-bottom:1px solid #dededb;background:#fff}
          .corralon-budget-search-meta>div{padding:9px 12px;border-right:1px solid #dededb;white-space:pre-wrap;overflow-wrap:anywhere}
          .corralon-budget-search-meta>div:last-child{border-right:0}
          .corralon-budget-search-meta b{display:block;margin-bottom:2px;color:#666;font:900 14px 'Barlow Condensed',Arial,sans-serif;text-transform:uppercase}
          .corralon-budget-search-meta span{color:#171717;font:700 15px Arial,sans-serif}
          .corralon-budget-search-detail-row{display:grid;grid-template-columns:130px minmax(360px,1fr) 110px 150px;min-height:36px;border-bottom:1px solid #e8e8e5}
          .corralon-budget-search-detail-row:nth-child(even){background:#f7f7f5}
          .corralon-budget-search-detail-row.head{position:sticky;top:0;z-index:1;background:#eeeeeb;color:#171717;font:900 16px 'Barlow Condensed',Arial,sans-serif}
          .corralon-budget-search-detail-row div{overflow:hidden;padding:8px 10px;border-right:1px solid #dededb;text-overflow:ellipsis;white-space:nowrap}
          .corralon-budget-search-detail-row .num{text-align:right;font-variant-numeric:tabular-nums}
          .corralon-budget-search-empty{display:flex;min-height:90px;align-items:center;justify-content:center;padding:18px;color:#888;font-weight:800;text-align:center}
          @media(max-width:720px){.corralon-budget-search-bg{padding:8px}.corralon-budget-search-modal{width:100%;height:94vh;border-radius:14px}.corralon-budget-search-head{padding:10px 12px}.corralon-budget-search-head h2{font-size:23px}.corralon-budget-search-body{padding:9px;grid-template-rows:auto auto auto minmax(120px,.75fr) minmax(210px,1.25fr)}.corralon-budget-search-dates{flex-wrap:wrap}.corralon-budget-search-meta{grid-template-columns:1fr}.corralon-budget-search-meta>div{border-right:0;border-bottom:1px solid #dededb}.corralon-budget-search-detail-row{min-width:700px}.corralon-budget-search-card{grid-template-columns:1fr}.corralon-budget-search-card b{white-space:normal}}
        `;
        document.head.appendChild(style);
      }
      let bg = document.getElementById('corralonBudgetSearchBg');
      if (!bg) {
        bg = document.createElement('div');
        bg.id = 'corralonBudgetSearchBg';
        bg.className = 'corralon-budget-search-bg';
        bg.innerHTML = `
          <div class="corralon-budget-search-modal" role="dialog" aria-modal="true" aria-labelledby="corralonBudgetSearchTitle">
            <div class="corralon-budget-search-head"><h2 id="corralonBudgetSearchTitle">Buscar en presupuestos</h2><button class="corralon-budget-search-close" type="button">Cerrar</button></div>
            <div class="corralon-budget-search-body">
              <div class="corralon-budget-search-field"><label>Buscar artículo presupuestado</label><input type="text" autocomplete="off" placeholder="Ej: cemento, grifería, código..."></div>
              <div class="corralon-budget-search-dates"><div><label for="corralonBudgetSearchFrom">Desde</label><input id="corralonBudgetSearchFrom" class="corralon-budget-search-date corralon-budget-search-from" type="text" autocomplete="off" placeholder="dd/mm/aaaa"></div><div><label for="corralonBudgetSearchTo">Hasta</label><input id="corralonBudgetSearchTo" class="corralon-budget-search-date corralon-budget-search-to" type="text" autocomplete="off" placeholder="dd/mm/aaaa"></div></div>
              <div class="corralon-budget-search-count">Escribí para buscar en presupuestos.</div>
              <div class="corralon-budget-search-results"></div>
              <div class="corralon-budget-search-detail"><div class="corralon-budget-search-empty">Elegí un presupuesto para ver el detalle.</div></div>
            </div>
          </div>`;
        document.body.appendChild(bg);
      }
      if (!uiBound) {
        uiBound = true;
        const input = bg.querySelector('input');
        const results = bg.querySelector('.corralon-budget-search-results');
        const dates = bg.querySelector('.corralon-budget-search-dates');
        const dateFields = [...dates.querySelectorAll('.corralon-budget-search-date')];
        const originalDateValues = new WeakMap();
        const normalizeDateField = (field) => {
          const value = String(field?.value || '').trim();
          if (!value) return null;
          const parsed = window.CorralonFunciones?.parseFechaFlexible?.(value);
          if (parsed) field.value = parsed.text;
          return parsed || null;
        };
        window.CorralonFunciones?.bindLinearNavigation?.({
          root: dates,
          selector: '.corralon-budget-search-date',
          selectOnFocus: true,
          navigateLeftRight: true,
          smartCaret: true,
          selectOnFirstPointerFocus: true
        });
        window.CorralonFunciones?.bindLabelSelect?.({
          root: dates,
          labelSelector: 'label',
          controlSelector: '.corralon-budget-search-date'
        });
        dateFields.forEach((field) => {
          field.addEventListener('focus', () => originalDateValues.set(field, field.value));
          field.addEventListener('blur', () => normalizeDateField(field));
          field.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              field.value = originalDateValues.get(field) ?? field.value;
              field.select();
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') normalizeDateField(field);
          });
        });
        input.addEventListener('input', () => {
          const count = bg.querySelector('.corralon-budget-search-count');
          count.textContent = input.value.trim() ? 'Presioná Enter para buscar.' : 'Escribí para buscar en presupuestos.';
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          search(input.value);
        });
        bg.querySelector('label').addEventListener('click', () => input.select());
        bg.querySelector('.corralon-budget-search-close').addEventListener('click', close);
        bg.addEventListener('mousedown', (event) => { if (event.target === bg) close(); });
        results.addEventListener('click', (event) => {
          const card = event.target.closest('[data-budget-search-key]');
          if (card) renderDetail(card.dataset.budgetSearchKey);
        });
        results.addEventListener('dblclick', (event) => {
          const card = event.target.closest('[data-budget-search-key]');
          const group = groups.find((item) => item.key === card?.dataset.budgetSearchKey);
          if (!group || typeof openOptions.onOpenBudget !== 'function') return;
          close();
          openOptions.onOpenBudget(group.budget, group.index);
        });
        results.addEventListener('keydown', (event) => {
          const card = event.target.closest('[data-budget-search-key]');
          if (!card) return;
          const cards = [...results.querySelectorAll('[data-budget-search-key]')];
          const index = cards.indexOf(card);
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); renderDetail(card.dataset.budgetSearchKey); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = cards[(index + (event.key === 'ArrowDown' ? 1 : -1) + cards.length) % cards.length];
            next?.focus();
            if (next) renderDetail(next.dataset.budgetSearchKey);
          }
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && bg.classList.contains('open')) { event.preventDefault(); close(); }
        });
      }
      return bg;
    }

    function collect(queryText) {
      const words = normalizeSearch(queryText).split(' ').filter(Boolean);
      if (!words.length) return [];
      return budgets.map((budget, index) => {
        const lines = (Array.isArray(budget.items) ? budget.items : []).filter((item) => {
          const text = normalizeSearch(`${item.codigo || item.idart || item.idArt || ''} ${item.nombre || item.descripcion || ''}`);
          return words.every((word) => text.includes(word));
        }).map((item) => ({
          codigo: item.codigo || item.idart || item.idArt || '',
          descripcion: item.nombre || item.descripcion || '',
          cantidad: item.cantidad ?? item.cant ?? '',
          precio: Number(item.precio ?? item.price ?? 0) || 0
        }));
        if (!lines.length) return null;
        return { key:String(budget.id || budget.numero || budget.nro || index + 1), index, budget, lines, timestamp:budgetTimestamp(budget) };
      }).filter(Boolean).sort((a, b) => b.timestamp - a.timestamp || String(b.key).localeCompare(String(a.key), 'es', { numeric:true }));
    }

    function renderDetail(key) {
      const bg = ensureUi();
      const detail = bg.querySelector('.corralon-budget-search-detail');
      const group = groups.find((item) => item.key === String(key));
      selectedKey = group?.key || '';
      bg.querySelectorAll('[data-budget-search-key]').forEach((card) => card.classList.toggle('active', card.dataset.budgetSearchKey === selectedKey));
      if (!group) { detail.innerHTML = '<div class="corralon-budget-search-empty">Elegí un presupuesto para ver el detalle.</div>'; return; }
      const rows = group.lines.map((item) => `<div class="corralon-budget-search-detail-row"><div>${escapeHtml(item.codigo)}</div><div title="${escapeHtml(item.descripcion)}">${escapeHtml(item.descripcion)}</div><div class="num">${escapeHtml(formatQuantity(item.cantidad))}</div><div class="num">${escapeHtml(formatMoney(item.precio))}</div></div>`).join('');
      detail.innerHTML = `<div class="corralon-budget-search-detail-title">${budgetDate(group.budget) ? `${escapeHtml(budgetDate(group.budget))} - ` : ''}${escapeHtml(budgetTitle(group.budget))} - Presupuesto ${escapeHtml(group.budget.numero || group.budget.id || '-')}</div><div class="corralon-budget-search-meta"><div><b>Usuario</b><span>${escapeHtml(budgetUser(group.budget))}</span></div><div><b>Nota</b><span>${escapeHtml(budgetNote(group.budget))}</span></div></div><div class="corralon-budget-search-detail-row head"><div>Código</div><div>Descripción</div><div class="num">Cantidad</div><div class="num">Precio</div></div>${rows}`;
    }

    function render() {
      const bg = ensureUi();
      const input = bg.querySelector('input');
      const count = bg.querySelector('.corralon-budget-search-count');
      const results = bg.querySelector('.corralon-budget-search-results');
      const detail = bg.querySelector('.corralon-budget-search-detail');
      const queryText = input.value.trim();
      if (!queryText) {
        groups = []; selectedKey = ''; count.textContent = 'Escribí para buscar en presupuestos.'; results.innerHTML = '';
        detail.innerHTML = '<div class="corralon-budget-search-empty">Elegí un presupuesto para ver el detalle.</div>'; return;
      }
      groups = collect(queryText);
      count.textContent = `${groups.length} presupuesto${groups.length === 1 ? '' : 's'} encontrado${groups.length === 1 ? '' : 's'} para "${queryText}"`;
      results.innerHTML = groups.map((group) => `<div class="corralon-budget-search-card" tabindex="0" role="button" data-budget-search-key="${escapeHtml(group.key)}"><div><strong>${budgetDate(group.budget) ? `${escapeHtml(budgetDate(group.budget))} - ` : ''}${escapeHtml(budgetTitle(group.budget))}</strong><span>${group.lines.length} línea${group.lines.length === 1 ? '' : 's'} encontrada${group.lines.length === 1 ? '' : 's'}</span></div><b>Presupuesto ${escapeHtml(group.budget.numero || group.budget.id || '-')} · ${escapeHtml(formatMoney(group.budget.total || 0))}</b></div>`).join('') || '<div class="corralon-budget-search-empty">No encontré presupuestos con ese artículo.</div>';
      if (groups.length) renderDetail(groups[0].key);
      else { selectedKey = ''; detail.innerHTML = '<div class="corralon-budget-search-empty">Sin resultados para mostrar.</div>'; }
    }

    async function fetchBudgets(queryText, fromDate = '', toDate = '') {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/buscar_presupuestos_web`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type':'application/json' },
        body: JSON.stringify({ p_consulta:queryText, p_limite:100, p_desde:fromDate || null, p_hasta:toDate || null })
      });
      if (!response.ok) throw new Error(await response.text() || 'No se pudieron cargar los presupuestos');
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    }

    async function search(queryText) {
      const bg = ensureUi();
      const query = String(queryText || '').trim();
      if (!query) { budgets = []; render(); return; }
      const parseSearchDate = (selector, label) => {
        const field = bg.querySelector(selector);
        const value = String(field?.value || '').trim();
        if (!value) return { iso:'', valid:true };
        const parsed = window.CorralonFunciones?.parseFechaFlexible?.(value);
        if (!parsed) return { iso:'', valid:false, label };
        field.value = parsed.text;
        return {
          iso:`${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`,
          valid:true
        };
      };
      const from = parseSearchDate('.corralon-budget-search-from', 'Desde');
      const to = parseSearchDate('.corralon-budget-search-to', 'Hasta');
      if (!from.valid || !to.valid) {
        bg.querySelector('.corralon-budget-search-count').textContent = `La fecha ${!from.valid ? from.label : to.label} no es válida.`;
        return;
      }
      const fromDate = from.iso;
      const toDate = to.iso;
      if (fromDate && toDate && fromDate > toDate) {
        bg.querySelector('.corralon-budget-search-count').textContent = 'La fecha Desde no puede ser posterior a Hasta.';
        return;
      }
      bg.querySelector('.corralon-budget-search-count').textContent = 'Buscando presupuestos...';
      try {
        const loaded = typeof openOptions.searchBudgets === 'function'
          ? await openOptions.searchBudgets(query, fromDate, toDate)
          : await fetchBudgets(query, fromDate, toDate);
        budgets = Array.isArray(loaded) ? loaded.slice() : [];
        render();
      } catch (error) {
        bg.querySelector('.corralon-budget-search-count').textContent = 'No se pudieron buscar los presupuestos.';
        console.error('No se pudo buscar en presupuestos', error);
      }
    }

    async function open(initialQuery = '', options = {}) {
      const bg = ensureUi();
      returnFocus = options.returnFocus || document.activeElement;
      openOptions = options;
      bg.classList.add('open');
      const input = bg.querySelector('input');
      input.value = String(initialQuery || '').trim();
      const today = new Date();
      const thirtyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
      const formatDefaultDate = (date) => `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      bg.querySelector('.corralon-budget-search-from').value = formatDefaultDate(thirtyDaysAgo);
      bg.querySelector('.corralon-budget-search-to').value = formatDefaultDate(today);
      budgets = [];
      groups = [];
      selectedKey = '';
      bg.querySelector('.corralon-budget-search-count').textContent = input.value ? 'Presioná Enter para buscar.' : 'Escribí para buscar en presupuestos.';
      bg.querySelector('.corralon-budget-search-results').innerHTML = '';
      bg.querySelector('.corralon-budget-search-detail').innerHTML = '<div class="corralon-budget-search-empty">Elegí un presupuesto para ver el detalle.</div>';
      requestAnimationFrame(() => { input.focus(); input.select(); });
    }

    function close() {
      document.getElementById('corralonBudgetSearchBg')?.classList.remove('open');
      const target = returnFocus;
      returnFocus = null;
      target?.focus?.({ preventScroll:true });
    }

    return {
      open,
      close,
      setBudgets(value) { budgets = Array.isArray(value) ? value.slice() : []; },
      isOpen() { return document.getElementById('corralonBudgetSearchBg')?.classList.contains('open') || false; }
    };
  })();

  const WEB_VERSION_NOTIFIER = (() => {
    const RAW_MANIFEST_URL = 'https://raw.githubusercontent.com/benjaminsuarez002-design/Corralonprogreso/main/version-web.json';
    const MANIFEST_URL = /^(https?:)$/i.test(location.protocol)
      ? new URL('/version-web.json', location.origin).toString()
      : RAW_MANIFEST_URL;
    const EXECUTED_VERSIONS_KEY = 'corralon_versiones_ejecutadas_v1';
    const FIREBASE_CONFIG = {
      apiKey: 'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',
      authDomain: 'corralon-progreso.firebaseapp.com',
      projectId: 'corralon-progreso',
      storageBucket: 'corralon-progreso.firebasestorage.app',
      messagingSenderId: '466583614632',
      appId: '1:466583614632:web:42cb839f83e97475fabe9d'
    };
    const FALLBACK_CHECK_MS = 60 * 1000;

    function localVersion() {
      const script = Array.from(document.scripts).find(item => /(?:^|\/)corralon-system\.js(?:\?|$)/i.test(item.src || ''));
      if (!script) return '0.0.0';
      try { return new URL(script.src, location.href).searchParams.get('v') || '0.0.0'; } catch (_) { return '0.0.0'; }
    }
    function pageKey() {
      let name = String(location.pathname.split('/').pop() || 'index').replace(/\.html?$/i, '').trim().toLowerCase();
      name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
      return name || 'index';
    }
    function recordExecutedVersion() {
      try {
        const versions = JSON.parse(localStorage.getItem(EXECUTED_VERSIONS_KEY) || '{}');
        versions[pageKey()] = {
          version: localVersion(),
          ejecutado_en: new Date().toISOString(),
          entorno: /^(localhost|127\.0\.0\.1)$/i.test(location.hostname) ? 'localhost' : location.hostname
        };
        localStorage.setItem(EXECUTED_VERSIONS_KEY, JSON.stringify(versions));
      } catch (_) {}
    }
    function versionParts(value) {
      return String(value || '0').split('.').map(part => Number(String(part).replace(/\D.*$/, '')) || 0);
    }
    function newer(remote, local) {
      const a = versionParts(remote), b = versionParts(local), length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
      }
      return false;
    }
    function priority(value) {
      const key = String(value || '').trim().toLowerCase();
      if (['importante', 'critica', 'critico', 'critical', 'alta', 'high'].includes(key)) return 'important';
      if (['media', 'mediana', 'medium', 'amarilla', 'yellow'].includes(key)) return 'medium';
      return 'normal';
    }
    function ensureStyle() {
      if (document.getElementById('corralon-version-style')) return;
      const style = document.createElement('style');
      style.id = 'corralon-version-style';
      style.textContent = `
        #corralon-version-toast{position:fixed;left:50%;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:12px;width:min(660px,calc(100% - 24px));padding:13px 15px;border:1px solid rgba(0,0,0,.15);border-radius:14px;box-shadow:0 16px 45px rgba(0,0,0,.28);font-family:Barlow,Arial,sans-serif;font-weight:800;transform:translate(-50%,calc(100% + 45px));opacity:0;transition:transform .24s ease,opacity .24s ease}
        #corralon-version-toast.visible{transform:translate(-50%,0);opacity:1}
        #corralon-version-toast.normal{background:#e7f8ed;color:#075f2c;border-color:#6bc68e}
        #corralon-version-toast.medium{background:#fff5cc;color:#664b00;border-color:#e8bd36}
        #corralon-version-toast.important{background:#e71920;color:#fff;border-color:#9f0005}
        #corralon-version-toast .version-copy{display:grid;gap:2px;min-width:0;flex:1}
        #corralon-version-toast strong{font-size:15px;line-height:1.15}#corralon-version-toast small{font-size:12px;opacity:.86}
        #corralon-version-toast button{flex:0 0 auto;border:1px solid currentColor;border-radius:9px;background:#fff;color:#151515;padding:8px 12px;font:900 13px Barlow,Arial,sans-serif;cursor:pointer}
        @media(max-width:560px){#corralon-version-toast{align-items:stretch;flex-direction:column}#corralon-version-toast button{width:100%}}
      `;
      document.head.appendChild(style);
    }
    function updatePage(version) {
      const url = new URL(location.href);
      url.searchParams.set('_version', String(version || Date.now()));
      location.replace(url.toString());
    }
    function show(manifest) {
      if (!document.body) return;
      ensureStyle();
      const level = priority(manifest.prioridad || manifest.priority);
      let toast = document.getElementById('corralon-version-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'corralon-version-toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
      }
      const label = level === 'important' ? 'Actualización importante' : level === 'medium' ? 'Actualización recomendada' : 'Ajuste disponible';
      const detail = String(manifest.mensaje || manifest.message || label).trim();
      toast.className = level;
      toast.innerHTML = `<span class="version-copy"><strong>Nueva versión disponible: ${String(manifest.version || '')}</strong><small>${detail}. Actualizá la página.</small></span><button type="button">Actualizar página</button>`;
      toast.querySelector('button').onclick = () => updatePage(manifest.version);
      requestAnimationFrame(() => toast.classList.add('visible'));
    }
    async function check(realtimeConfig = null) {
      try {
        let response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok && MANIFEST_URL !== RAW_MANIFEST_URL) {
          response = await fetch(`${RAW_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
        }
        if (!response.ok) return;
        const manifest = await response.json();
        const currentPageKey = pageKey();
        const page = manifest.paginas?.[currentPageKey] || manifest;
        const overrideKey = `${currentPageKey}__${page.version || ''}`;
        const globalOverrideKey = `__global____${page.version || ''}`;
        const overridePriority = realtimeConfig?.prioridades?.[overrideKey] || realtimeConfig?.prioridades?.[globalOverrideKey];
        if (newer(page.version, localVersion())) show({ ...manifest, ...page, ...(overridePriority ? { prioridad: overridePriority } : {}) });
      } catch (_) {}
    }
    async function startRealtime() {
      const [appModule, firestoreModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
      ]);
      const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(FIREBASE_CONFIG);
      const firestore = firestoreModule.getFirestore(app);
      return firestoreModule.onSnapshot(
        firestoreModule.doc(firestore, 'configuracion', 'version_web'),
        (snapshot) => check(snapshot.exists() ? snapshot.data() : null),
        () => {}
      );
    }
    function start() {
      const begin = () => {
        recordExecutedVersion();
        check();
        setInterval(check, FALLBACK_CHECK_MS);
        startRealtime().catch(() => {});
      };
      if (document.body) begin(); else document.addEventListener('DOMContentLoaded', begin, { once: true });
    }
    return { start, check, localVersion, pageKey, recordExecutedVersion };
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
    buildNewArticlesXlsBlob,
    saveBlobAs,
    buildImageGeneratorPayload,
    setImageGeneratorCatalog,
    getImageGeneratorCatalog,
    getImageGeneratorCatalogAsync,
    setImageGeneratorPayload,
    readImageGeneratorPayload,
    openImageGenerator,
    providerEditor: {
      apply: applyProviderEditorLayout
    },
    numericCalculator: NUMERIC_CALCULATOR,
    newArticlesImporter: NEW_ARTICLES_IMPORTER,
    budgetSearch: BUDGET_SEARCH,
    articleEditor: {
      configure: configureArticleEditor,
      open: openArticleEditor,
      close: closeArticleEditor,
      publishCatalog: publishArticleCatalog
    },
    aridos: {
      configure: configureAridos,
      setConfigMap: setAridosConfigMap,
      setFreightConfig: setAridosFreightConfig,
      decorateArticle: decorateAridArticle,
      getConfig: aridConfigForArticle,
      getFreightConfig: () => ({ ...aridosFreightConfig }),
      openBudget: openAridosBudget,
      closeBudget: closeAridosBudget,
      calculateMaterial: calculateAridMaterial
    },
    catalogEditorSession: CATALOG_EDITOR_SESSION,
    catalog: CATALOG,
    catalogRealtime: CATALOG_REALTIME,
    faltantes: FALTANTES,
    versionNotifier: WEB_VERSION_NOTIFIER
  };
  CATALOG_REALTIME.start();
  WEB_VERSION_NOTIFIER.start();
  const migrateLargeLocalCaches = async () => {
    try { await getImageGeneratorCatalogAsync(); } catch (_) {}
    try {
      if (await CATALOG.hasLocalCache()) localStorage.removeItem('corralon_index_lista_articulos_cache_v1');
    } catch (_) {}
  };
  if ('requestIdleCallback' in window) requestIdleCallback(() => migrateLargeLocalCaches(), { timeout: 2500 });
  else setTimeout(migrateLargeLocalCaches, 600);
  } catch (error) {
    window.__corralonSystemError = {
      name: String(error?.name || 'Error'),
      message: String(error?.message || error || 'Error desconocido'),
      stack: String(error?.stack || '')
    };
    console.error('No se pudo iniciar CorralonSystem', error);
  }
})();
