(function () {
  const KEEP_LOGIN_KEY = 'historial_keep_logged_v1';
  const ACTIVE_USER_KEY = 'corralon_menu_active_user_v1';
  const ACTIVE_USER_SNAPSHOT_KEY = 'corralon_menu_active_user_snapshot_v1';
  const ACTIVE_USER_SESSION_KEY = 'corralon_menu_active_user_session_v1';
  const USERS_CACHE_KEY = 'corralon_menu_users_cache_v1';
  const USERS_COLLECTION = 'menuUsuarios';
  const ALL_MENU_IDS = ['lista', 'remitos', 'historial', 'comprobantes', 'caja', 'faltantes', 'pedidos', 'actualizar_articulos', 'proveedores', 'listas_proveedores', 'admin', 'garantias', 'usuarios', 'calculadoras'];
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
    'actualizar articulos': 'actualizar_articulos',
    'actualizar%20articulos': 'actualizar_articulos',
    proveedores: 'proveedores',
    listasproveedores: 'listas_proveedores',
    soloadmin: 'admin',
    garantias: 'garantias',
    'garantías': 'garantias',
    usuarios: 'usuarios',
    calculadoras: 'calculadoras'
  };

  document.documentElement.style.visibility = 'hidden';

  const rawFile = decodeURIComponent(location.pathname.split('/').pop() || '').toLowerCase();
  const pageKey = rawFile.replace(/\.html?$/i, '');
  const pageId = document.currentScript?.dataset?.menuGuard || pageIds[pageKey] || pageIds[rawFile];

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
    try { sessionStorage.removeItem(ACTIVE_USER_SESSION_KEY); } catch (_) {}
  }

  function normalizeUser(raw = {}) {
    return {
      id: String(raw.id || raw.usuario || raw.nombre || '').trim(),
      nombre: String(raw.nombre || raw.usuario || '').trim(),
      usuario: String(raw.usuario || '').trim(),
      nivel: String(raw.nivel || 'personalizado').trim().toLowerCase(),
      permisos: Array.isArray(raw.permisos) ? raw.permisos.map(String) : []
    };
  }

  function userPermissions(user) {
    if (!user) return [];
    if (user.nivel === 'administrador') return ALL_MENU_IDS;
    if (user.nivel === 'vendedor') return DEFAULT_SELLER_IDS;
    return user.permisos || [];
  }

  function canAccess(user) {
    return Boolean(pageId && userPermissions(user).includes(pageId));
  }

  function activeUserId() {
    return String(localStorage.getItem(ACTIVE_USER_KEY) || '').trim();
  }

  function keepLogged() {
    return localStorage.getItem(KEEP_LOGIN_KEY) === '1';
  }

  function saveActiveUser(user) {
    if (!user?.id) return;
    localStorage.setItem(ACTIVE_USER_KEY, user.id);
    localStorage.setItem(ACTIVE_USER_SNAPSHOT_KEY, JSON.stringify(user));
    try { sessionStorage.setItem(ACTIVE_USER_SESSION_KEY, JSON.stringify(user)); } catch (_) {}
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some((script) => script.src === src)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function firestoreDb() {
    if (!window.firebase?.firestore) {
      await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js');
    }
    if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
    return window.firebase.firestore();
  }

  async function getRemoteUser(id) {
    const db = await firestoreDb();
    const doc = await db.collection(USERS_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return normalizeUser({ id: doc.id, ...doc.data() });
  }

  async function validate() {
    if (!pageId) {
      clearSession();
      redirectTo('index.html');
      return;
    }
    const id = activeUserId();
    if (!keepLogged() || !id) {
      clearSession();
      redirectTo('index.html');
      return;
    }
    try {
      const user = await getRemoteUser(id);
      if (!user) {
        clearSession();
        redirectTo('index.html');
        return;
      }
      saveActiveUser(user);
      try {
        const db = await firestoreDb();
        db.collection(USERS_COLLECTION).get().then((snap) => {
          const users = snap.docs.map((item) => normalizeUser({ id: item.id, ...item.data() }));
          if (users.length) localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
        }).catch(() => {});
      } catch (_) {}
      if (!canAccess(user)) {
        redirectTo('menu.html');
        return;
      }
      document.documentElement.style.visibility = '';
    } catch (error) {
      console.warn('No se pudo validar el usuario', error);
      clearSession();
      redirectTo('index.html');
    }
  }

  validate();
})();
