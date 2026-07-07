const config = window.OP_CONFIG || {};
let episodes = [...(window.OP_EPISODES || [])].sort((a, b) => a.order - b.order);

const els = {
  authStatus: document.querySelector("#authStatus"),
  setupWarning: document.querySelector("#setupWarning"),
  episodeList: document.querySelector("#episodeList"),
  video: document.querySelector("#video"),
  driveFrame: document.querySelector("#driveFrame"),
  nowTitle: document.querySelector("#nowTitle"),
  nowMeta: document.querySelector("#nowMeta"),
  playSelected: document.querySelector("#playSelected"),
  nextEpisode: document.querySelector("#nextEpisode"),
  markWatched: document.querySelector("#markWatched"),
  clearCache: document.querySelector("#clearCache"),
  connectDrive: document.querySelector("#connectDrive"),
  downloadText: document.querySelector("#downloadText"),
  downloadBar: document.querySelector("#downloadBar"),
  downloadOverlay: document.querySelector("#downloadOverlay"),
  downloadOverlayText: document.querySelector("#downloadOverlayText"),
  downloadOverlayBar: document.querySelector("#downloadOverlayBar"),
  preloadText: document.querySelector("#preloadText"),
  preloadBar: document.querySelector("#preloadBar"),
  episodeConfirm: document.querySelector("#episodeConfirm"),
  episodeConfirmText: document.querySelector("#episodeConfirmText"),
  cancelEpisodePlay: document.querySelector("#cancelEpisodePlay"),
  confirmEpisodePlay: document.querySelector("#confirmEpisodePlay")
};

let app = null;
let db = null;
let uid = "local";
let activeUser = null;
let tokenClient = null;
let driveToken = "";
let driveTokenPromise = null;
let pendingDriveTokenRequest = null;
let exactProgressTimer = 0;
let lastProgressRender = 0;
let selectedEpisode = episodes[0] || null;
let currentEpisode = null;
let currentObjectUrl = "";
let saveTimer = 0;
let isLoadingEpisode = false;
let progressById = new Map();
let downloadJobs = new Map();
let pendingEpisodeToPlay = null;
let previewTimer = 0;
let previewTracking = false;
let previewLastTick = 0;
let previewTime = 0;
let previewSaveCount = 0;
let catalogSyncTimer = 0;

const KEEP_LOGIN_KEY = "historial_keep_logged_v1";
const ACTIVE_USER_KEY = "corralon_menu_active_user_v1";
const ACTIVE_USER_SNAPSHOT_KEY = "corralon_menu_active_user_snapshot_v1";
const ACTIVE_USER_SESSION_KEY = "corralon_menu_active_user_session_v1";
const USERS_CACHE_KEY = "corralon_menu_users_cache_v1";
const USERS_COLLECTION = "menuUsuarios";
const PROGRESS_COLLECTION = "onePieceProgreso";
const DRIVE_TOKEN_KEY = "one_piece_drive_token_v1";
const DRIVE_CATALOG_KEY = "one_piece_drive_catalog_v1";
const DRIVE_FOLDER_ID = config.drive?.folderId || "1N8awrcgHVDSajwKmHe7PLgGubTfdaQ7X";

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
  loadCachedDriveCatalog();
  renderEpisodes();
  selectEpisode(selectedEpisode);
  setupFirebase();
  setupGoogleDrive();
  await requestPersistentStorage();
  bindEvents();
  await setupMenuLogin();
  syncDriveCatalog({ interactive: false }).catch(() => {});
  startCatalogAutoSync();
  await refreshStorageEstimate();
}

function bindEvents() {
  els.playSelected.addEventListener("click", () => selectedEpisode && playEpisode(selectedEpisode));
  els.nextEpisode.addEventListener("click", playNextEpisode);
  els.clearCache.addEventListener("click", async () => {
    await clearVideoCache();
    setDownloadProgress(0, "Caché limpia");
    setPreloadProgress(0, "Esperando");
  });
  els.markWatched.addEventListener("click", async () => {
    if (!currentEpisode) return;
    await saveProgress(currentEpisode, true);
    renderEpisodes();
  });
  els.connectDrive.addEventListener("click", () => {
    requestDriveToken().catch(error => {
      console.error(error);
      alert("No se pudo autorizar Google Drive. Abrí la app desde http://127.0.0.1:4173/ y revisá el origen autorizado.");
    });
  });
  els.cancelEpisodePlay.addEventListener("click", closeEpisodeConfirm);
  els.confirmEpisodePlay.addEventListener("click", confirmEpisodePlayback);
  els.episodeConfirm.addEventListener("click", event => {
    if (event.target === els.episodeConfirm) closeEpisodeConfirm();
  });
  els.video.addEventListener("timeupdate", onTimeUpdate);
  els.video.addEventListener("ended", onEnded);
  els.video.addEventListener("play", () => {
    stopPreviewTicker();
    startExactProgressTimer();
  });
  els.video.addEventListener("pause", () => {
    if (currentEpisode) saveProgress(currentEpisode).catch(() => {});
  });
  els.video.addEventListener("seeking", () => {
    if (currentEpisode) saveProgress(currentEpisode).catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && currentEpisode) saveProgress(currentEpisode).catch(() => {});
  });
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

function setupGoogleDrive() {
  if (!config.google?.clientId) {
    els.connectDrive.textContent = "Drive falta";
    return;
  }

  restoreStoredDriveToken();

  if (location.protocol === "file:") {
    els.nowMeta.textContent = "OAuth de Google no funciona abriendo el HTML como archivo. Usá http://127.0.0.1:4173/";
  }

  const waitForGoogle = () => {
    if (!window.google?.accounts?.oauth2) {
      window.setTimeout(waitForGoogle, 250);
      return;
    }

    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: config.google.clientId,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      callback: response => {
        if (response?.access_token) {
          rememberDriveToken(response);
          els.connectDrive.textContent = "Drive OK";
          if (driveTokenPromise) driveTokenPromise.resolve(driveToken);
          syncDriveCatalog({ interactive: false }).catch(error => console.warn("No se pudo sincronizar catalogo", error));
        } else if (response?.error && driveTokenPromise) {
          driveTokenPromise.reject(new Error(response.error));
        } else if (driveTokenPromise) {
          driveTokenPromise.reject(new Error("Google no devolvio token de Drive"));
        }
        driveTokenPromise = null;
      }
    });

    els.connectDrive.textContent = "Autorizar Drive";
    if (driveToken) els.connectDrive.textContent = "Drive OK";
  };

  waitForGoogle();
}

function restoreStoredDriveToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRIVE_TOKEN_KEY) || "null");
    if (saved?.accessToken && Number(saved.expiresAt || 0) > Date.now() + 60000) {
      driveToken = saved.accessToken;
      els.connectDrive.textContent = "Drive OK";
      return driveToken;
    }
    localStorage.removeItem(DRIVE_TOKEN_KEY);
  } catch (_) {
    localStorage.removeItem(DRIVE_TOKEN_KEY);
  }
  return "";
}

function rememberDriveToken(response) {
  driveToken = response.access_token || "";
  const expiresIn = Number(response.expires_in || 3600);
  const expiresAt = Date.now() + Math.max(60, expiresIn - 120) * 1000;
  try {
    localStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify({ accessToken: driveToken, expiresAt }));
  } catch (_) {}
}

function clearDriveToken() {
  driveToken = "";
  try { localStorage.removeItem(DRIVE_TOKEN_KEY); } catch (_) {}
  els.connectDrive.textContent = "Autorizar Drive";
}

function requestDriveToken(options = {}) {
  const interactive = options.interactive !== false;
  if (location.protocol === "file:") {
    return Promise.reject(new Error("OAuth no funciona desde file://. Abri la app desde http://127.0.0.1:4173/"));
  }
  restoreStoredDriveToken();
  if (driveToken) return Promise.resolve(driveToken);
  if (!interactive) return Promise.reject(new Error("Drive token no disponible"));
  if (!tokenClient) return Promise.reject(new Error("Google Identity Services todavia no cargo"));

  if (pendingDriveTokenRequest) return pendingDriveTokenRequest;

  pendingDriveTokenRequest = new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      driveTokenPromise = null;
      pendingDriveTokenRequest = null;
      reject(new Error("Google Drive no respondio a tiempo"));
    }, 25000);

    driveTokenPromise = {
      resolve: token => {
        window.clearTimeout(timer);
        pendingDriveTokenRequest = null;
        resolve(token);
      },
      reject: error => {
        window.clearTimeout(timer);
        pendingDriveTokenRequest = null;
        reject(error);
      }
    };
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });

  return pendingDriveTokenRequest;
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
  if (isLoadingEpisode) {
    els.nowMeta.textContent = "Espera a que termine la descarga actual antes de cargar otro capitulo.";
    return;
  }
  isLoadingEpisode = true;
  currentEpisode = episode;
  selectEpisode(episode);
  els.nowTitle.textContent = episode.title;
  stopExactProgressTimer();
  stopPreviewTicker();
  els.driveFrame.hidden = true;
  els.driveFrame.removeAttribute("src");
  els.video.hidden = false;
  els.nowMeta.textContent = "Preparando archivo local desde Drive...";
  setDownloadProgress(0, "Preparando...");

  let blob = null;
  try {
    blob = await getOrDownloadEpisode(episode, "current");
  } catch (error) {
    console.error(error);
    els.nowMeta.textContent = "No se pudo descargar el MP4 bruto. Tocá Drive para autorizar de nuevo o abrilo desde http://127.0.0.1:4173/.";
    setDownloadProgress(0, "Error Drive");
    isLoadingEpisode = false;
    return;
  }
  if (!blob) {
    isLoadingEpisode = false;
    return;
  }

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(blob);
  els.video.onerror = () => {
    els.nowMeta.textContent = "El archivo descargado no se pudo reproducir en este navegador.";
    setDownloadProgress(0, "Video error");
  };
  els.video.src = currentObjectUrl;

  const progress = progressById.get(episode.id);
  els.video.onloadedmetadata = () => {
    if (progress?.currentTime && progress.currentTime < els.video.duration - 20) {
      els.video.currentTime = progress.currentTime;
    }
    els.video.play().catch(() => {});
  };

  els.nowMeta.textContent = `${formatBytes(blob.size)} guardados localmente.`;
  setPreloadProgress(0, "Manual");
  isLoadingEpisode = false;
}

function playDirectFromDrive(episode, message) {
  stopPreviewTicker();
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
  startPreviewTicker(episode);
  els.nowMeta.textContent = previewStatusText(episode, "Drive bloqueo el MP4 directo. Guardando progreso aproximado mientras este reproductor esta abierto.");
  setDownloadProgress(100, "Drive preview");
  setPreloadProgress(0, "Sin cache");
}

function startPreviewTicker(episode) {
  stopPreviewTicker();
  const saved = progressById.get(episode.id);
  previewTime = Number(saved?.currentTime || 0);
  previewTracking = true;
  previewLastTick = Date.now();
  previewSaveCount = 0;
  els.toggleProgress.textContent = "Pausar progreso";
  updatePreviewProgressUi(episode);

  previewTimer = window.setInterval(async () => {
    if (!currentEpisode || currentEpisode.id !== episode.id) return;
    const now = Date.now();
    const elapsed = Math.max(0, (now - previewLastTick) / 1000);
    previewLastTick = now;

    if (previewTracking && !document.hidden) {
      previewTime = Math.min(estimatedDuration(episode), previewTime + elapsed);
      previewSaveCount += elapsed;
      updatePreviewProgressUi(episode);
      if (previewSaveCount >= 10) {
        previewSaveCount = 0;
        await saveProgress(episode);
      }
    }
  }, 1000);
}

function stopPreviewTicker() {
  if (previewTimer) window.clearInterval(previewTimer);
  previewTimer = 0;
  previewTracking = false;
}

function startExactProgressTimer() {
  stopExactProgressTimer();
  exactProgressTimer = window.setInterval(() => {
    if (!currentEpisode || !els.video.duration || els.video.paused || els.video.ended) return;
    saveProgress(currentEpisode).catch(error => console.warn("No se pudo guardar progreso", error));
  }, 10000);
}

function stopExactProgressTimer() {
  if (exactProgressTimer) window.clearInterval(exactProgressTimer);
  exactProgressTimer = 0;
}

function togglePreviewTracking() {
  if (!currentEpisode) return;
  previewTracking = !previewTracking;
  previewLastTick = Date.now();
  els.toggleProgress.textContent = previewTracking ? "Pausar progreso" : "Seguir progreso";
  updatePreviewProgressUi(currentEpisode);
}

function adjustPreviewProgress(seconds) {
  if (!currentEpisode) return;
  previewTime = Math.max(0, Math.min(estimatedDuration(currentEpisode), previewTime + seconds));
  updatePreviewProgressUi(currentEpisode);
  saveProgress(currentEpisode).catch(() => {});
}

function updatePreviewProgressUi(episode) {
  const duration = estimatedDuration(episode);
  const percent = duration ? Math.min(100, Math.round((previewTime / duration) * 100)) : 0;
  setDownloadProgress(percent, `${percent}% aprox`);
  els.nowMeta.textContent = previewStatusText(episode);
  const existing = progressById.get(episode.id) || {};
  progressById.set(episode.id, {
    ...existing,
    currentTime: previewTime,
    duration,
    percent,
    watched: percent >= 90,
    approximate: true,
    updatedAt: Date.now()
  });
  renderEpisodes();
}

function previewStatusText(episode, prefix = "Progreso aproximado activo.") {
  const duration = estimatedDuration(episode);
  return `${prefix} Ibas por ${formatTime(previewTime)} de ${formatTime(duration)} aprox. En otro dispositivo adelanta manualmente hasta ese minuto.`;
}

async function preloadNextEpisode(episode) {
  setPreloadProgress(0, "Manual");
  return;

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
  const token = await requestDriveToken({ interactive: slot === "current" });
  const url = getDownloadUrl(episode);
  let response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (response.status === 401 || response.status === 403) {
    clearDriveToken();
    const freshToken = await requestDriveToken({ interactive: slot === "current" });
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${freshToken}`
      }
    });
  }
  if (!response.ok) throw new Error(`Drive respondio ${response.status}`);
  const responseType = response.headers.get("content-type") || "";
  if (responseType && !responseType.toLowerCase().includes("video") && !responseType.toLowerCase().includes("octet-stream")) {
    throw new Error(`Drive no devolvio video: ${responseType}`);
  }

  const total = Number(response.headers.get("content-length")) || episode.size || 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (!isPlayableVideoBlob(blob)) throw new Error("La descarga no parece un video valido");
    await putCachedVideo(episode, blob);
    await keepOnlyCurrent(episode.id);
    if (slot === "current") setDownloadProgress(100, "Listo");
    if (slot === "preload") setPreloadProgress(100, "Listo");
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
  await keepOnlyCurrent(episode.id);
  if (slot === "current") setDownloadProgress(100, "Listo");
  if (slot === "preload") setPreloadProgress(100, "Listo");
  return blob;
}

function isPlayableVideoBlob(blob) {
  if (!blob) return false;
  if (blob.size < 1024 * 1024) return false;
  const type = String(blob.type || "").toLowerCase();
  return !type || type.startsWith("video/") || type.includes("octet-stream");
}

function getDownloadUrl(episode) {
  return `https://www.googleapis.com/drive/v3/files/${episode.driveFileId}?alt=media`;
}

async function onTimeUpdate() {
  if (!currentEpisode || !els.video.duration) return;
  const data = buildProgressData(currentEpisode);
  progressById.set(currentEpisode.id, data);
  localStorage.setItem(`progress:${currentEpisode.id}`, JSON.stringify(data));
  if (Date.now() - lastProgressRender > 5000) {
    lastProgressRender = Date.now();
    renderEpisodes();
  }
}

async function onEnded() {
  if (!currentEpisode) return;

  stopExactProgressTimer();
  await saveProgress(currentEpisode, true);
  els.nowMeta.textContent = "Capitulo terminado. Toca Siguiente para borrar este capitulo y descargar el proximo.";
  return;
  await deleteCachedVideo(currentEpisode.id);

  const index = episodes.findIndex(item => item.id === currentEpisode.id);
  const next = episodes[index + 1];
  if (next) {
    await playEpisode(next);
  } else {
    els.nowMeta.textContent = "Terminaste los capítulos cargados.";
  }
}

async function playNextEpisode() {
  if (isLoadingEpisode) {
    els.nowMeta.textContent = "Espera a que termine la descarga actual antes de pasar al siguiente.";
    return;
  }

  const baseEpisode = currentEpisode || selectedEpisode;
  if (!baseEpisode) return;

  const index = episodes.findIndex(item => item.id === baseEpisode.id);
  const next = episodes[index + 1];
  if (!next) {
    els.nowMeta.textContent = "No hay siguiente capitulo cargado.";
    setPreloadProgress(0, "No hay siguiente");
    return;
  }

  if (currentEpisode) {
    await saveProgress(currentEpisode).catch(() => {});
    await deleteCachedVideo(currentEpisode.id).catch(() => {});
  }

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = "";
  }

  setPreloadProgress(0, "Manual");
  selectEpisode(next);
  await playEpisode(next);
}

async function saveProgress(episode, forceDone = false) {
  const data = buildProgressData(episode, forceDone);
  const { currentTime, duration, percent, watched, approximate } = data;

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
    approximate,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function buildProgressData(episode, forceDone = false) {
  const usingPreview = !els.driveFrame.hidden;
  const duration = usingPreview ? estimatedDuration(episode) : (els.video.duration || 0);
  const currentTime = usingPreview ? previewTime : (els.video.currentTime || 0);
  const percent = duration ? Math.min(100, Math.round((currentTime / duration) * 100)) : 0;
  return {
    currentTime,
    duration,
    percent,
    watched: forceDone || percent >= 90,
    approximate: usingPreview,
    updatedAt: Date.now()
  };
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
    await autoLoadResumeEpisode();
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
  await autoLoadResumeEpisode();
}

async function autoLoadResumeEpisode() {
  const resumeEpisode = findResumeEpisode();
  if (!resumeEpisode) return;

  selectEpisode(resumeEpisode);
  els.nowTitle.textContent = resumeEpisode.title;

  const saved = progressById.get(resumeEpisode.id);
  const savedText = saved?.currentTime ? `Quedaste en ${formatTime(saved.currentTime)} (${saved.percent || 0}%).` : "";
  const hasCached = await hasCachedVideo(resumeEpisode.id);
  const hasDrive = Boolean(restoreStoredDriveToken());

  if (hasCached || hasDrive) {
    els.nowMeta.textContent = `${savedText} Cargando automaticamente...`;
    playEpisode(resumeEpisode).catch(error => {
      console.warn("No se pudo auto reanudar", error);
      els.nowMeta.textContent = `${savedText} Toca Autorizar Drive y Cargar y reproducir.`;
    });
    return;
  }

  els.nowMeta.textContent = `${savedText} Toca Autorizar Drive y despues Cargar y reproducir.`;
}

function findResumeEpisode() {
  const candidates = episodes
    .map(episode => ({ episode, progress: progressById.get(episode.id) }))
    .filter(item => item.progress && !item.progress.watched && Number(item.progress.currentTime || 0) > 5)
    .sort((a, b) => progressUpdatedAt(b.progress) - progressUpdatedAt(a.progress));

  return candidates[0]?.episode || null;
}

function progressUpdatedAt(progress) {
  if (!progress) return 0;
  if (typeof progress.updatedAt === "number") return progress.updatedAt;
  if (typeof progress.updatedAt?.toMillis === "function") return progress.updatedAt.toMillis();
  if (typeof progress.updatedAt?.seconds === "number") return progress.updatedAt.seconds * 1000;
  return 0;
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

function loadCachedDriveCatalog() {
  try {
    const cached = JSON.parse(localStorage.getItem(DRIVE_CATALOG_KEY) || "null");
    if (Array.isArray(cached?.episodes) && cached.episodes.length) {
      episodes = cached.episodes.sort((a, b) => a.order - b.order);
      selectedEpisode = episodes.find(item => item.id === selectedEpisode?.id) || episodes[0] || null;
    }
  } catch (_) {
    localStorage.removeItem(DRIVE_CATALOG_KEY);
  }
}

function startCatalogAutoSync() {
  if (catalogSyncTimer) window.clearInterval(catalogSyncTimer);
  catalogSyncTimer = window.setInterval(() => {
    if (driveToken) syncDriveCatalog({ interactive: false }).catch(() => {});
  }, 60000);
}

async function syncDriveCatalog(options = {}) {
  if (!DRIVE_FOLDER_ID) return;
  const token = await requestDriveToken({ interactive: options.interactive === true });
  const files = await listDriveFolderVideos(token);
  if (!files.length) return;

  const nextEpisodes = files.map(fileToEpisode).filter(Boolean).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  if (!nextEpisodes.length) return;

  const currentId = selectedEpisode?.id;
  episodes = nextEpisodes;
  selectedEpisode = episodes.find(item => item.id === currentId) || findResumeEpisode() || episodes[0] || null;

  try {
    localStorage.setItem(DRIVE_CATALOG_KEY, JSON.stringify({ updatedAt: Date.now(), episodes }));
  } catch (_) {}

  renderEpisodes();
  if (selectedEpisode && !currentEpisode) selectEpisode(selectedEpisode);
}

async function listDriveFolderVideos(token) {
  const fields = "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)";
  const query = `'${DRIVE_FOLDER_ID}' in parents and trashed=false`;
  const files = [];
  let pageToken = "";

  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", query);
    url.searchParams.set("fields", fields);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "name_natural");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401 || response.status === 403) {
      clearDriveToken();
      throw new Error(`Drive catalogo respondio ${response.status}`);
    }
    if (!response.ok) throw new Error(`Drive catalogo respondio ${response.status}`);

    const data = await response.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return files.filter(file => {
    const name = String(file.name || "");
    return (file.mimeType || "").startsWith("video/") || /\.(mp4|mkv|webm|mov|m4v)$/i.test(name);
  });
}

function fileToEpisode(file) {
  const filename = String(file.name || "").trim();
  const parsed = parseEpisodeFilename(filename);
  const order = parsed.order ?? Number.MAX_SAFE_INTEGER;
  return {
    id: `drive-${file.id}`,
    order,
    range: parsed.range || String(order),
    arc: parsed.arc || "",
    part: parsed.part || "",
    title: parsed.title || filename.replace(/\.[^.]+$/, ""),
    filename,
    mimeType: file.mimeType || "video/mp4",
    size: Number(file.size || 0),
    modifiedTime: file.modifiedTime || "",
    driveFileId: file.id,
    driveUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
  };
}

function parseEpisodeFilename(filename) {
  const clean = filename.replace(/\.[^.]+$/, "");
  const match = clean.match(/^\[One Pace\]\[([^\]]+)\]\s+(.+?)(?:\s+\[[^\]]+\].*)?$/i);
  if (!match) {
    const anyNumber = clean.match(/\d+/);
    return {
      order: anyNumber ? Number(anyNumber[0]) : Number.MAX_SAFE_INTEGER,
      range: anyNumber?.[0] || "",
      title: clean
    };
  }

  const range = match[1].trim();
  const title = match[2].trim();
  const orderMatch = range.match(/\d+/);
  const partMatch = title.match(/(\d+)\s*$/);
  const arc = partMatch ? title.slice(0, partMatch.index).trim() : title;

  return {
    order: orderMatch ? Number(orderMatch[0]) : Number.MAX_SAFE_INTEGER,
    range,
    arc,
    part: partMatch?.[1] || "",
    title
  };
}

function openEpisodeConfirm(episode) {
  pendingEpisodeToPlay = episode;
  els.episodeConfirmText.textContent = `Se limpiara la cache y se descargara "${episode.title}".`;
  els.episodeConfirm.hidden = false;
}

function closeEpisodeConfirm() {
  pendingEpisodeToPlay = null;
  els.episodeConfirm.hidden = true;
}

async function confirmEpisodePlayback() {
  const episode = pendingEpisodeToPlay;
  if (!episode || isLoadingEpisode) return;

  closeEpisodeConfirm();
  if (currentEpisode) {
    await saveProgress(currentEpisode).catch(() => {});
  }
  await clearVideoCache();
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = "";
  }
  setDownloadProgress(0, "Cache limpia");
  setPreloadProgress(0, "Manual");
  selectEpisode(episode);
  await playEpisode(episode);
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
    button.addEventListener("click", () => openEpisodeConfirm(episode));
    els.episodeList.appendChild(button);
  });
}

function selectEpisode(episode) {
  if (!episode) return;
  selectedEpisode = episode;
  const progress = progressById.get(episode.id);
  els.nowTitle.textContent = episode.title;
  const saved = progress?.currentTime ? ` · guardado ${formatTime(progress.currentTime)} (${progress.percent || 0}%)` : "";
  els.nowMeta.textContent = `${episode.range} · ${formatBytes(episode.size)}${saved} · ${episode.filename}`;
  renderEpisodes();
}

function setDownloadProgress(percent, text) {
  els.downloadText.textContent = text;
  els.downloadBar.style.width = `${percent || 0}%`;
  setDownloadOverlay(percent, text);
}

function setPreloadProgress(percent, text) {
  els.preloadText.textContent = text;
  els.preloadBar.style.width = `${percent || 0}%`;
}

function setDownloadOverlay(percent, text) {
  if (!els.downloadOverlay) return;
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const label = text || `${value}%`;
  const shouldShow = currentEpisode && (value < 100 || /prepar|descarg|error/i.test(label));
  els.downloadOverlay.hidden = !shouldShow;
  els.downloadOverlayText.textContent = label;
  els.downloadOverlayBar.style.width = `${value}%`;
  if (value >= 100 && !/error/i.test(label)) {
    window.setTimeout(() => {
      if (els.downloadText.textContent === label) els.downloadOverlay.hidden = true;
    }, 700);
  }
}

function estimatedDuration(episode) {
  const bytes = Number(episode?.size || 0);
  if (!bytes) return 30 * 60;
  const estimated = Math.round((bytes * 8) / 1650000);
  return Math.max(18 * 60, Math.min(60 * 60, estimated));
}

function formatTime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  const min = Math.floor(value / 60);
  const sec = value % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
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

async function keepOnlyCurrent(currentId) {
  const keep = new Set([currentId].filter(Boolean));
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
