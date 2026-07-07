const config = window.OP_CONFIG || {};
const episodes = [...(window.OP_EPISODES || [])].sort((a, b) => a.order - b.order);

const els = {
  authStatus: document.querySelector("#authStatus"),
  setupWarning: document.querySelector("#setupWarning"),
  episodeList: document.querySelector("#episodeList"),
  video: document.querySelector("#video"),
  driveFrame: document.querySelector("#driveFrame"),
  nowTitle: document.querySelector("#nowTitle"),
  nowMeta: document.querySelector("#nowMeta"),
  playSelected: document.querySelector("#playSelected"),
  clearCache: document.querySelector("#clearCache"),
  connectDrive: document.querySelector("#connectDrive"),
  downloadText: document.querySelector("#downloadText"),
  downloadBar: document.querySelector("#downloadBar"),
  preloadText: document.querySelector("#preloadText"),
  preloadBar: document.querySelector("#preloadBar")
};

let app = null;
let db = null;
let uid = "local";
let activeUser = null;
let selectedEpisode = episodes[0] || null;
let currentEpisode = null;
let currentObjectUrl = "";
let saveTimer = 0;
let progressById = new Map();
let downloadJobs = new Map();

const KEEP_LOGIN_KEY = "historial_keep_logged_v1";
const ACTIVE_USER_KEY = "corralon_menu_active_user_v1";
const ACTIVE_USER_SNAPSHOT_KEY = "corralon_menu_active_user_snapshot_v1";
const ACTIVE_USER_SESSION_KEY = "corralon_menu_active_user_session_v1";
const USERS_CACHE_KEY = "corralon_menu_users_cache_v1";
const USERS_COLLECTION = "menuUsuarios";
const PROGRESS_COLLECTION = "onePieceProgreso";

const loginEls = {
  bg: document.querySelector("#loginBg"),
  user: document.querySelector("#loginUserInput"),
  pass: document.querySelector("#loginInput"),
  remember: document.querySelector("#rememberLogin"),
  users: document.querySelector("#loginUsersList"),
  button: document.querySelector("#loginBtn"),
  error: document.querySelector("#loginError")
};

let menuUsers = [];

const dbName = "one-piece-player";
const blobStore = "videos";

init();

async function init() {
  renderEpisodes();
  selectEpisode(selectedEpisode);
  setupFirebase();
  await requestPersistentStorage();
  bindEvents();
  await setupMenuLogin();
  await refreshStorageEstimate();
}

function bindEvents() {
  els.playSelected.addEventListener("click", () => selectedEpisode && playEpisode(selectedEpisode));
  els.clearCache.addEventListener("click", async () => {
    await clearVideoCache();
    setDownloadProgress(0, "Caché limpia");
    setPreloadProgress(0, "Esperando");
  });
  els.connectDrive.addEventListener("click", () => {
    if (selectedEpisode?.driveUrl) window.open(selectedEpisode.driveUrl, "_blank", "noopener");
  });
  els.video.addEventListener("timeupdate", onTimeUpdate);
  els.video.addEventListener("ended", onEnded);
  loginEls.button.addEventListener("click", verifyMenuLogin);
  loginEls.pass.addEventListener("keydown", event => {
    if (event.key === "Enter") verifyMenuLogin();
  });
  loginEls.users.addEventListener("click", event => {
    const button = event.target.closest(".login-user-btn");
    if (!button) return;
    loginEls.user.value = button.dataset.user || "";
    loginEls.users.querySelectorAll(".login-user-btn").forEach(item => {
      item.classList.toggle("active", item === button);
    });
    loginEls.pass.focus();
    loginEls.pass.select();
  });
}

function setupFirebase() {
  const fb = config.firebase || {};
  const hasFirebase = Boolean(fb.apiKey && fb.projectId && fb.appId);

  els.setupWarning.hidden = hasFirebase;

  if (!hasFirebase) {
    els.authStatus.textContent = "Modo local";
    return;
  }

  if (!window.firebase?.firestore) {
    els.authStatus.textContent = "Firebase no cargó";
    return;
  }

  if (!window.firebase.apps.length) window.firebase.initializeApp(fb);
  app = window.firebase.app();
  db = window.firebase.firestore();
  els.authStatus.textContent = "Firebase activo";
}

async function playEpisode(episode) {
  currentEpisode = episode;
  selectEpisode(episode);
  els.nowTitle.textContent = episode.title;
  playDirectFromDrive(episode, "Reproduciendo directo desde Drive. La cache local queda desactivada por bloqueo CORS de Google Drive.");
}

function playDirectFromDrive(episode, message) {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = "";
  }

  els.driveFrame.hidden = true;
  els.driveFrame.removeAttribute("src");
  els.video.hidden = false;
  const progress = progressById.get(episode.id);
  els.video.onerror = () => {
    showDrivePreview(episode);
  };
  els.video.onloadedmetadata = () => {
    if (progress?.currentTime && progress.currentTime < els.video.duration - 20) {
      els.video.currentTime = progress.currentTime;
    }
    els.video.play().catch(() => {});
  };
  els.video.src = getDownloadUrl(episode);
  els.video.load();
  els.nowMeta.textContent = message;
  setDownloadProgress(100, "Directo");
  setPreloadProgress(0, "Sin cache");
}

function showDrivePreview(episode) {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = "";
  }
  els.video.pause();
  els.video.removeAttribute("src");
  els.video.load();
  els.video.hidden = true;
  els.driveFrame.hidden = false;
  els.driveFrame.src = `https://drive.google.com/file/d/${episode.driveFileId}/preview`;
  els.nowMeta.textContent = "Drive bloqueo el MP4 directo. Reproduciendo con el visor de Drive; en este modo el minuto exacto no se puede guardar automaticamente.";
  setDownloadProgress(100, "Drive preview");
  setPreloadProgress(0, "Sin cache");
}

async function preloadNextEpisode(episode) {
  const index = episodes.findIndex(item => item.id === episode.id);
  const next = episodes[index + 1];
  if (!next) {
    setPreloadProgress(0, "No hay siguiente");
    return;
  }

  if (await hasCachedVideo(next.id)) {
    setPreloadProgress(100, "Listo");
    return;
  }

  try {
    await getOrDownloadEpisode(next, "preload");
    setPreloadProgress(100, "Listo");
  } catch (error) {
    console.error(error);
    setPreloadProgress(0, "No se pudo preparar");
  }
}

async function getOrDownloadEpisode(episode, slot) {
  const cached = await getCachedVideo(episode.id);
  if (cached && isPlayableVideoBlob(cached.blob)) {
    if (slot === "current") setDownloadProgress(100, "Listo");
    if (slot === "preload") setPreloadProgress(100, "Listo");
    return cached.blob;
  }
  if (cached) await deleteCachedVideo(episode.id);

  if (downloadJobs.has(episode.id)) return downloadJobs.get(episode.id);

  const job = downloadEpisode(episode, slot)
    .finally(() => downloadJobs.delete(episode.id));

  downloadJobs.set(episode.id, job);
  return job;
}

async function downloadEpisode(episode, slot) {
  const url = getDownloadUrl(episode);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Drive respondio ${response.status}`);
  const responseType = response.headers.get("content-type") || "";
  if (responseType && !responseType.toLowerCase().includes("video") && !responseType.toLowerCase().includes("octet-stream")) {
    throw new Error(`Drive no devolvio video: ${responseType}`);
  }

  const total = Number(response.headers.get("content-length")) || episode.size || 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    await putCachedVideo(episode, blob);
    return blob;
  }

  const chunks = [];
  let loaded = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const percent = total ? Math.round((loaded / total) * 100) : 0;
    if (slot === "current") setDownloadProgress(percent, `${percent}%`);
    if (slot === "preload") setPreloadProgress(percent, `${percent}%`);
  }

  const blob = new Blob(chunks, { type: episode.mimeType || "video/mp4" });
  if (!isPlayableVideoBlob(blob)) throw new Error("La descarga no parece un video valido");
  await putCachedVideo(episode, blob);
  await keepOnlyCurrentAndNext(currentEpisode?.id || episode.id);
  return blob;
}

function isPlayableVideoBlob(blob) {
  if (!blob) return false;
  if (blob.size < 1024 * 1024) return false;
  const type = String(blob.type || "").toLowerCase();
  return !type || type.startsWith("video/") || type.includes("octet-stream");
}

function getDownloadUrl(episode) {
  return `https://drive.usercontent.google.com/download?id=${episode.driveFileId}&export=download&confirm=t`;
}

async function onTimeUpdate() {
  if (!currentEpisode || !els.video.duration) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveProgress(currentEpisode), 700);
}

async function onEnded() {
  if (!currentEpisode) return;

  await saveProgress(currentEpisode, true);
  await deleteCachedVideo(currentEpisode.id);

  const index = episodes.findIndex(item => item.id === currentEpisode.id);
  const next = episodes[index + 1];
  if (next) {
    await playEpisode(next);
  } else {
    els.nowMeta.textContent = "Terminaste los capítulos cargados.";
  }
}

async function saveProgress(episode, forceDone = false) {
  const duration = els.video.duration || 0;
  const currentTime = els.video.currentTime || 0;
  const percent = duration ? Math.min(100, Math.round((currentTime / duration) * 100)) : 0;
  const watched = forceDone || percent >= 90;
  const data = { currentTime, duration, percent, watched, updatedAt: Date.now() };

  progressById.set(episode.id, data);
  localStorage.setItem(`progress:${episode.id}`, JSON.stringify(data));
  renderEpisodes();

  if (!db || !activeUser?.id) return;

  await db.collection(PROGRESS_COLLECTION).doc(`${uid}_${episode.id}`).set({
    userId: uid,
    usuario: activeUser.usuario || activeUser.nombre || uid,
    episodeId: episode.id,
    driveFileId: episode.driveFileId,
    title: episode.title,
    currentTime,
    duration,
    percent,
    watched,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function loadAllProgress() {
  await Promise.all(episodes.map(async episode => {
    const local = localStorage.getItem(`progress:${episode.id}`);
    if (local) progressById.set(episode.id, JSON.parse(local));

    if (!db || !activeUser?.id) return;
    const snap = await db.collection(PROGRESS_COLLECTION).doc(`${uid}_${episode.id}`).get();
    if (snap.exists) progressById.set(episode.id, snap.data());
  }));
}

async function setupMenuLogin() {
  await loadMenuUsers();
  renderLoginUsers();
  const rememberedUser = getRememberedUser();
  if (rememberedUser) {
    activeUser = rememberedUser;
    uid = rememberedUser.id;
    await loadAllProgress();
    renderEpisodes();
    hideLogin();
    updateUserStatus();
    return;
  }
  showLogin();
}

async function loadMenuUsers() {
  const cached = readUsersCache();
  if (cached.length) menuUsers = cached;
  if (!db) return menuUsers;

  try {
    const snap = await db.collection(USERS_COLLECTION).get();
    const remoteUsers = snap.docs.map(item => normalizeMenuUser({ id: item.id, ...item.data() }));
    if (remoteUsers.length) {
      menuUsers = remoteUsers;
      localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(menuUsers));
    }
  } catch (error) {
    console.warn("No se pudieron leer usuarios de menuUsuarios", error);
  }

  return menuUsers;
}

function readUsersCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(USERS_CACHE_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(normalizeMenuUser).filter(user => user.id) : [];
  } catch (_) {
    return [];
  }
}

function normalizeMenuUser(raw = {}) {
  return {
    id: String(raw.id || raw.usuario || raw.nombre || "").trim(),
    nombre: String(raw.nombre || raw.usuario || "").trim(),
    usuario: String(raw.usuario || raw.nombre || "").trim(),
    password: String(raw.password || ""),
    nivel: String(raw.nivel || "personalizado").trim(),
    permisos: Array.isArray(raw.permisos) ? raw.permisos.map(String) : []
  };
}

function renderLoginUsers() {
  loginEls.users.innerHTML = menuUsers.map(user => `
    <button class="login-user-btn" type="button" data-user="${escapeHtml(user.usuario || user.nombre)}">
      ${escapeHtml(user.nombre || user.usuario || "-")}
    </button>
  `).join("");
}

async function verifyMenuLogin() {
  if (!menuUsers.length) await loadMenuUsers();
  const username = String(loginEls.user.value || "").trim().toLowerCase();
  const password = String(loginEls.pass.value || "");
  const user = menuUsers.find(item => String(item.usuario || item.nombre || "").trim().toLowerCase() === username);

  if (!user || password !== String(user.password || "")) {
    loginEls.error.textContent = "Usuario o contraseña incorrectos";
    loginEls.pass.value = "";
    loginEls.user.focus();
    return;
  }

  activeUser = user;
  uid = user.id;
  rememberUser(user, loginEls.remember.checked);
  loginEls.error.textContent = "";
  await loadAllProgress();
  renderEpisodes();
  hideLogin();
  updateUserStatus();
}

function rememberUser(user, remember) {
  const snapshot = {
    id: user.id,
    nombre: user.nombre || user.usuario || "Usuario",
    usuario: user.usuario || user.nombre || "",
    nivel: user.nivel || "personalizado",
    permisos: user.permisos || []
  };
  localStorage.setItem(ACTIVE_USER_KEY, user.id);
  localStorage.setItem(ACTIVE_USER_SNAPSHOT_KEY, JSON.stringify(snapshot));
  try { sessionStorage.setItem(ACTIVE_USER_SESSION_KEY, JSON.stringify(snapshot)); } catch (_) {}
  if (remember) localStorage.setItem(KEEP_LOGIN_KEY, "1");
  else localStorage.removeItem(KEEP_LOGIN_KEY);
}

function getRememberedUser() {
  if (localStorage.getItem(KEEP_LOGIN_KEY) !== "1") return null;
  const activeId = localStorage.getItem(ACTIVE_USER_KEY);
  if (!activeId) return null;
  const fromUsers = menuUsers.find(user => user.id === activeId);
  if (fromUsers) return fromUsers;
  try {
    const snapshot = JSON.parse(localStorage.getItem(ACTIVE_USER_SNAPSHOT_KEY) || "null");
    return snapshot?.id === activeId ? normalizeMenuUser(snapshot) : null;
  } catch (_) {
    return null;
  }
}

function showLogin() {
  loginEls.bg.style.display = "flex";
  els.authStatus.textContent = db ? "Ingrese usuario" : "Modo local";
  requestAnimationFrame(() => loginEls.user.focus());
}

function hideLogin() {
  loginEls.bg.style.display = "none";
}

function updateUserStatus() {
  els.authStatus.textContent = activeUser ? `${activeUser.nombre || activeUser.usuario}` : "Firebase activo";
}

function renderEpisodes() {
  els.episodeList.innerHTML = "";
  episodes.forEach(episode => {
    const progress = progressById.get(episode.id);
    const button = document.createElement("button");
    button.className = [
      "episode",
      selectedEpisode?.id === episode.id ? "active" : "",
      progress?.watched ? "done" : ""
    ].join(" ");
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(episode.title)}</strong>
        <span>${escapeHtml(episode.range)} · ${formatBytes(episode.size)}</span>
      </span>
      <small class="badge">${progress?.watched ? "Visto" : `${progress?.percent || 0}%`}</small>
    `;
    button.addEventListener("click", () => selectEpisode(episode));
    els.episodeList.appendChild(button);
  });
}

function selectEpisode(episode) {
  if (!episode) return;
  selectedEpisode = episode;
  els.nowTitle.textContent = episode.title;
  els.nowMeta.textContent = `${episode.range} · ${formatBytes(episode.size)} · ${episode.filename}`;
  renderEpisodes();
}

function setDownloadProgress(percent, text) {
  els.downloadText.textContent = text;
  els.downloadBar.style.width = `${percent || 0}%`;
}

function setPreloadProgress(percent, text) {
  els.preloadText.textContent = text;
  els.preloadBar.style.width = `${percent || 0}%`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(blobStore, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx(storeName, mode, run) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = run(store);
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function putCachedVideo(episode, blob) {
  return tx(blobStore, "readwrite", store => store.put({
    id: episode.id,
    blob,
    title: episode.title,
    size: blob.size,
    cachedAt: Date.now()
  }));
}

async function getCachedVideo(id) {
  return tx(blobStore, "readonly", store => store.get(id));
}

async function hasCachedVideo(id) {
  return Boolean(await getCachedVideo(id));
}

async function deleteCachedVideo(id) {
  return tx(blobStore, "readwrite", store => store.delete(id));
}

async function clearVideoCache() {
  return tx(blobStore, "readwrite", store => store.clear());
}

async function keepOnlyCurrentAndNext(currentId) {
  const currentIndex = episodes.findIndex(episode => episode.id === currentId);
  const keep = new Set([currentId, episodes[currentIndex + 1]?.id].filter(Boolean));
  const database = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(blobStore, "readwrite");
    const store = transaction.objectStore(blobStore);
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      keys.result.forEach(key => {
        if (!keep.has(key)) store.delete(key);
      });
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function requestPersistentStorage() {
  if (navigator.storage?.persist) {
    await navigator.storage.persist().catch(() => false);
  }
}

async function refreshStorageEstimate() {
  if (!navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  console.info("Storage estimate", estimate);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
