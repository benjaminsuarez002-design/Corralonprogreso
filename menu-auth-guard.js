(function () {
  if (!document.querySelector('script[data-sale-reviews-loader]')) {
    const script=document.createElement('script');script.src=new URL('facturacion-revisiones.js',document.currentScript?.src||location.href).href;
    script.dataset.saleReviewsLoader='1';document.head.appendChild(script);
  }
  const KEEP_LOGIN_KEY = 'historial_keep_logged_v1';
  const ACTIVE_USER_KEY = 'corralon_menu_active_user_v1';
  const ACTIVE_USER_SNAPSHOT_KEY = 'corralon_menu_active_user_snapshot_v1';
  const ACTIVE_USER_SESSION_KEY = 'corralon_menu_active_user_session_v1';
  const SHARED_SESSION_KEY = 'corralon_menu_shared_session_v1';
  const USERS_CACHE_KEY = 'corralon_menu_users_cache_v1';
  const USERS_COLLECTION = 'menuUsuarios';
  const CATALOG_EDITOR_LOCAL_KEY = 'corralon_catalogo_editor_session_v1';
  const CATALOG_EDITOR_SESSION_KEY = 'corralon_catalogo_editor_session_temp_v1';
  const ALL_MENU_IDS = ['lista', 'a_descontar', 'remitos', 'historial', 'comprobantes', 'caja', 'faltantes', 'pedidos', 'facturacion', 'cargar_facturas', 'proveedores_sql', 'tarjetas', 'actualizar_articulos', 'carga_stock', 'articulos_sql', 'proveedores', 'listas_proveedores', 'diferencias_proveedores', 'admin', 'garantias', 'usuarios', 'calculadoras', 'configuracion'];
  const DEFAULT_SELLER_IDS = ['lista', 'remitos', 'admin', 'garantias'];
  const firebaseConfig = {
    apiKey: 'AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0',
    authDomain: 'corralon-progreso.firebaseapp.com',
    projectId: 'corralon-progreso',
    storageBucket: 'corralon-progreso.firebasestorage.app',
    messagingSenderId: '1027678878292',
    appId: '1:1027678878292:web:6cb10fb7cd7070a0314ace'
  };
  const pageIds = {
    remitos: 'remitos',
    historial: 'historial',
    comprobantes: 'comprobantes',
    caja: 'caja',
    faltantes: 'faltantes',
    pedidos: 'pedidos',
    facturacion: 'facturacion',
    'cargar-facturas': 'cargar_facturas',
    'proveedores-sql': 'proveedores_sql',
    tarjetas: 'tarjetas',
    'actualizar articulos': 'actualizar_articulos',
    'actualizar%20articulos': 'actualizar_articulos',
    cargastock: 'carga_stock',
    'articulos-sql': 'articulos_sql',
    proveedores: 'proveedores',
    listasproveedores: 'listas_proveedores',
    'diferencias-proveedores': 'diferencias_proveedores',
    soloadmin: 'admin',
    garantias: 'garantias',
    'garantías': 'garantias',
    usuarios: 'usuarios',
    calculadoras: 'calculadoras',
    configuracion: 'configuracion'
  };

  document.documentElement.style.visibility = 'hidden';

  const rawFile = decodeURIComponent(location.pathname.split('/').pop() || '').toLowerCase();
  const pageKey = rawFile.replace(/\.html?$/i, '');
  const pageId = document.currentScript?.dataset?.menuGuard || pageIds[pageKey] || pageIds[rawFile];
  const loginPage = ['facturacion', 'cargar_facturas', 'proveedores_sql', 'carga_stock', 'articulos_sql'].includes(pageId) ? 'menu.html' : 'index.html';
  const sharedComprobantesView = pageId === 'comprobantes'
    && Boolean(new URLSearchParams(location.search).get('resumenCompartido'));

  if (sharedComprobantesView) {
    document.documentElement.style.visibility = '';
    return;
  }

  function targetUrl(file) {
    return file;
  }

  function redirectTo(file) {
    const current = decodeURIComponent(location.pathname.split('/').pop() || '').toLowerCase();
    if (current === file.toLowerCase()) {
      document.documentElement.style.visibility = '';
      return;
    }
    location.replace(targetUrl(file));
  }

  function clearSession() {
    localStorage.removeItem(KEEP_LOGIN_KEY);
    localStorage.removeItem(ACTIVE_USER_KEY);
    localStorage.removeItem(ACTIVE_USER_SNAPSHOT_KEY);
    localStorage.removeItem(CATALOG_EDITOR_LOCAL_KEY);
    try { sessionStorage.removeItem(ACTIVE_USER_SESSION_KEY); } catch (_) {}
    localStorage.removeItem(SHARED_SESSION_KEY);
    try { sessionStorage.removeItem(CATALOG_EDITOR_SESSION_KEY); } catch (_) {}
  }

  function normalizeUser(raw = {}) {
    return {
      id: String(raw.id || raw.usuario || raw.nombre || '').trim(),
      nombre: String(raw.nombre || raw.usuario || '').trim(),
      usuario: String(raw.usuario || '').trim(),
      idOperador: Number(raw.idOperador) || null,
      nivel: String(raw.nivel || 'personalizado').trim().toLowerCase(),
      permisos: Array.isArray(raw.permisos) ? raw.permisos.map(String) : [],
      cajaModo: String(raw.nivel || '').trim().toLowerCase() === 'administrador' ? 'completo' : (['lector','restringido'].includes(raw.cajaModo) ? 'restringido' : 'completo'),
      cajaSucursalId: String(raw.cajaSucursalId || '')
    };
  }

  function userPermissions(user) {
    if (!user) return [];
    if (user.nivel === 'administrador') return ALL_MENU_IDS;
    if (user.nivel === 'vendedor') return DEFAULT_SELLER_IDS;
    return user.permisos || [];
  }

  function canAccess(user) {
    if (pageId === 'configuracion') return user?.nivel === 'administrador';
    return Boolean(pageId && userPermissions(user).includes(pageId));
  }

  function activeUserId() {
    return String(localStorage.getItem(ACTIVE_USER_KEY) || '').trim();
  }

  function keepLogged() {
    return localStorage.getItem(KEEP_LOGIN_KEY) === '1';
  }

  function temporarySession() {
    try {
      const data = JSON.parse(sessionStorage.getItem(ACTIVE_USER_SESSION_KEY) || localStorage.getItem(SHARED_SESSION_KEY) || 'null');
      const usuario = data?.usuario?.id ? data.usuario : data?.id ? data : null;
      if (!usuario?.id || Number(data.expiresAt || 0) <= Date.now()) {
        sessionStorage.removeItem(ACTIVE_USER_SESSION_KEY);
        localStorage.removeItem(SHARED_SESSION_KEY);
        return null;
      }
      return { ...data, usuario };
    } catch (_) {
      sessionStorage.removeItem(ACTIVE_USER_SESSION_KEY);
      localStorage.removeItem(SHARED_SESSION_KEY);
      return null;
    }
  }

  function saveActiveUser(user, persistent, temporary) {
    if (!user?.id) return;
    if (persistent) {
      localStorage.setItem(ACTIVE_USER_KEY, user.id);
      localStorage.setItem(ACTIVE_USER_SNAPSHOT_KEY, JSON.stringify(user));
      return;
    }
    try {
      const serialized = JSON.stringify({ ...user, usuario: user, expiresAt: temporary.expiresAt });
      sessionStorage.setItem(ACTIVE_USER_SESSION_KEY, serialized);
      localStorage.setItem(SHARED_SESSION_KEY, serialized);
    } catch (_) {}
  }

  let firestoreReady = null;
  async function firestoreDb() {
    if (!firestoreReady) {
      // El guard no modifica window.firebase ni compite con los scripts compat
      // de la página. Todas las validaciones esperan la misma inicialización.
      firestoreReady = Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
      ]).then(([apps, firestore]) => {
        const name = 'corralon-menu-auth-guard';
        const app = apps.getApps().find(item => item.name === name) || apps.initializeApp(firebaseConfig, name);
        return { ...firestore, db: firestore.getFirestore(app) };
      }).catch(error => { firestoreReady = null; throw error; });
    }
    return firestoreReady;
  }

  async function getRemoteUser(id) {
    const api = await firestoreDb();
    const snapshot = await api.getDoc(api.doc(api.db, USERS_COLLECTION, id));
    if (!snapshot.exists()) return null;
    return normalizeUser({ id: snapshot.id, ...snapshot.data() });
  }

  async function validate() {
    if (!pageId) {
      clearSession();
      redirectTo('index.html');
      return;
    }
    const persistent = keepLogged();
    const temporary = persistent ? null : temporarySession();
    const id = persistent ? activeUserId() : String(temporary?.usuario?.id || '').trim();
    if (!id) {
      clearSession();
      redirectTo(loginPage);
      return;
    }
    try {
      const user = await getRemoteUser(id);
      if (!user) {
        clearSession();
        redirectTo(loginPage);
        return;
      }
      saveActiveUser(user, persistent, temporary);
      window.dispatchEvent(new CustomEvent('menu-user-validated', { detail: { user } }));
      try {
        const api = await firestoreDb();
        api.getDocs(api.collection(api.db, USERS_COLLECTION)).then((snap) => {
          const users = snap.docs.map((item) => normalizeUser({ id: item.id, ...item.data() }));
          if (users.length) localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
        }).catch(() => {});
      } catch (_) {}
      if (!canAccess(user)) {
        redirectTo(pageId === 'configuracion' ? 'index.html' : 'menu.html');
        return;
      }
      document.documentElement.style.visibility = '';
    } catch (error) {
      console.warn('No se pudo validar el usuario', error);
      let cachedUser = temporary?.usuario || null;
      if (persistent) {
        try { cachedUser = JSON.parse(localStorage.getItem(ACTIVE_USER_SNAPSHOT_KEY) || 'null'); } catch (_) {}
      }
      cachedUser = normalizeUser(cachedUser || {});
      if (cachedUser.id === id && canAccess(cachedUser)) {
        window.dispatchEvent(new CustomEvent('menu-user-validated', { detail: { user: cachedUser, offline: true } }));
        document.documentElement.style.visibility = '';
        return;
      }
      clearSession();
      redirectTo(loginPage);
    }
  }

  validate();
})();
