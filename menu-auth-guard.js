(function () {
  const KEEP_LOGIN_KEY = 'historial_keep_logged_v1';
  const ACTIVE_USER_KEY = 'corralon_menu_active_user_v1';
  const ACTIVE_USER_SNAPSHOT_KEY = 'corralon_menu_active_user_snapshot_v1';
  const USERS_CACHE_KEY = 'corralon_menu_users_cache_v1';
  const USERS_COLLECTION = 'menuUsuarios';
  const ALL_MENU_IDS = ['lista', 'remitos', 'historial', 'comprobantes', 'caja', 'faltantes', 'pedidos', 'actualizar_articulos', 'proveedores', 'listas_proveedores', 'admin', 'garantias', 'usuarios', 'calculadoras'];
  const DEFAULT_SELLER_IDS = ['lista', 'remitos', 'admin', 'garantias'];
  const firebaseConfig = {
    apiKey: "AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0",
    authDomain: "corralon-progreso.firebaseapp.com",
    projectId: "corralon-progreso",
    storageBucket: "corralon-progreso.firebasestorage.app",
    messagingSenderId: "1027678878292",
    appId: "1:1027678878292:web:6cb10fb7cd7070a0314ace"
  };
  const pageIds = {
    'remitos.html': 'remitos',
    'historial.html': 'historial',
    'comprobantes.html': 'comprobantes',
    'caja.html': 'caja',
    'faltantes.html': 'faltantes',
    'pedidos.html': 'pedidos',
    'actualizar articulos.html': 'actualizar_articulos',
    'proveedores.html': 'proveedores',
    'listasproveedores.html': 'listas_proveedores',
    'soloadmin.html': 'admin',
    'garantÃ­as.html': 'garantias',
    'garantias.html': 'garantias',
    'usuarios.html': 'usuarios',
    'calculadoras.html': 'calculadoras'
  };
  const currentFile = decodeURIComponent(location.pathname.split('/').pop() || '').toLowerCase();
  const pageId = document.currentScript?.dataset?.menuGuard || pageIds[currentFile];
  if (!pageId) return;

  function redirectTo(target) {
    const current = decodeURIComponent(location.pathname.split('/').pop() || '').toLowerCase();
    if (current === target.toLowerCase()) return;
    location.replace(target);
  }

  function defaultUsers() {
    return [
      { id: 'admin', nombre: 'Administrador', usuario: 'admin', nivel: 'administrador', permisos: ALL_MENU_IDS },
      { id: 'vendedor', nombre: 'Vendedor', usuario: 'vendedor', nivel: 'vendedor', permisos: DEFAULT_SELLER_IDS }
    ];
  }

  function normalizeUser(raw = {}) {
    return {
      id: String(raw.id || raw.usuario || raw.nombre || '').trim(),
      nombre: String(raw.nombre || raw.usuario || '').trim(),
      usuario: String(raw.usuario || '').trim(),
      nivel: String(raw.nivel || 'personalizado').trim(),
      permisos: Array.isArray(raw.permisos) ? raw.permisos : []
    };
  }

  function userPermissions(user) {
    if (!user) return [];
    if (user.nivel === 'administrador') return ALL_MENU_IDS;
    if (user.nivel === 'vendedor') return DEFAULT_SELLER_IDS;
    return Array.isArray(user.permisos) ? user.permisos : [];
  }

  function canAccess(user) {
    return userPermissions(user).includes(pageId);
  }

  function activeUserId() {
    return localStorage.getItem(ACTIVE_USER_KEY) || '';
  }

  function storedUserSnapshot() {
    try {
      const user = JSON.parse(localStorage.getItem(ACTIVE_USER_SNAPSHOT_KEY) || 'null');
      return user && user.id === activeUserId() ? normalizeUser(user) : null;
    } catch {
      localStorage.removeItem(ACTIVE_USER_SNAPSHOT_KEY);
      return null;
    }
  }

  function saveActiveUser(user) {
    if (!user?.id) return;
    localStorage.setItem(ACTIVE_USER_KEY, user.id);
    localStorage.setItem(ACTIVE_USER_SNAPSHOT_KEY, JSON.stringify(normalizeUser(user)));
  }

  function clearSession() {
    localStorage.removeItem(KEEP_LOGIN_KEY);
    localStorage.removeItem(ACTIVE_USER_KEY);
    localStorage.removeItem(ACTIVE_USER_SNAPSHOT_KEY);
  }

  function validateLocalSession() {
    const keep = localStorage.getItem(KEEP_LOGIN_KEY) === '1';
    const user = storedUserSnapshot();
    if (!keep || !activeUserId() || !user) {
      clearSession();
      redirectTo('index.html');
      return null;
    }
    if (!canAccess(user)) {
      redirectTo('menu.html');
      return null;
    }
    return user;
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

  async function validateRemoteSession() {
    const id = activeUserId();
    if (!id) {
      clearSession();
      redirectTo('index.html');
      return;
    }
    try {
      const db = await firestoreDb();
      const doc = await db.collection(USERS_COLLECTION).doc(id).get();
      let user = doc.exists ? normalizeUser({ id: doc.id, ...doc.data() }) : null;
      if (!user) user = defaultUsers().find((item) => item.id === id) || null;
      if (!user) {
        clearSession();
        redirectTo('index.html');
        return;
      }
      saveActiveUser(user);
      if (!canAccess(user)) {
        redirectTo('menu.html');
        return;
      }
      db.collection(USERS_COLLECTION).get().then((snap) => {
        const users = snap.docs.map((item) => normalizeUser({ id: item.id, ...item.data() }));
        if (users.length) localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
      }).catch(() => {});
    } catch (error) {
      console.warn('No se pudo validar el usuario en segundo plano', error);
    }
  }

  if (validateLocalSession()) setTimeout(validateRemoteSession, 0);
})();



