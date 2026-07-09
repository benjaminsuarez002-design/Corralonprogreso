const DB_NAME = "one-piece-player";
const STORE_NAME = "videos";
const TOKEN_CACHE = {
  accessToken: ""
};
let activeFetch = {
  episodeId: "",
  controller: null
};

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "SET_DRIVE_TOKEN") {
    TOKEN_CACHE.accessToken = data.accessToken || "";
  }
  if (data.type === "CLEAR_DRIVE_TOKEN") {
    TOKEN_CACHE.accessToken = "";
  }
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (!url.pathname.endsWith("/__onepace_video__")) return;

  event.respondWith(handleVideoRequest(event.request, event.clientId));
});

async function handleVideoRequest(request, clientId) {
  const url = new URL(request.url);
  const episodeId = url.searchParams.get("episodeId");
  const fileId = url.searchParams.get("fileId");
  const mimeType = url.searchParams.get("mimeType") || "video/mp4";
  const title = url.searchParams.get("title") || episodeId || "video";

  if (!episodeId || !fileId) {
    return new Response("Missing video id", { status: 400 });
  }

  const cached = await getCachedVideo(episodeId);
  if (cached?.blob) {
    return responseFromBlob(cached.blob, request.headers.get("range"), mimeType);
  }

  if (!TOKEN_CACHE.accessToken) {
    return new Response("Drive token missing", { status: 401 });
  }

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const headers = {
    Authorization: `Bearer ${TOKEN_CACHE.accessToken}`
  };
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  if (activeFetch.controller && activeFetch.episodeId !== episodeId) {
    activeFetch.controller.abort();
  }
  const controller = new AbortController();
  activeFetch = { episodeId, controller };

  const driveResponse = await fetch(driveUrl, { headers, signal: controller.signal });
  if (!driveResponse.ok) {
    return new Response(`Drive responded ${driveResponse.status}`, { status: driveResponse.status });
  }

  const total = totalBytesFromHeaders(driveResponse.headers);
  const canCache = !range || /^bytes=0-?$/i.test(range);
  const responseHeaders = copyVideoHeaders(driveResponse.headers, mimeType);

  if (!driveResponse.body || !canCache) {
    return new Response(driveResponse.body, {
      status: driveResponse.status,
      statusText: driveResponse.statusText,
      headers: responseHeaders
    });
  }

  const [playbackStream, cacheStream] = driveResponse.body.tee();
  cacheVideoStream(cacheStream, { episodeId, title, mimeType, total, clientId }).catch(error => {
    postClient(clientId, {
      type: "VIDEO_CACHE_ERROR",
      episodeId,
      message: error?.message || String(error)
    });
  });

  return new Response(playbackStream, {
    status: driveResponse.status,
    statusText: driveResponse.statusText,
    headers: responseHeaders
  });
}

function responseFromBlob(blob, rangeHeader, mimeType) {
  const size = blob.size;
  if (!rangeHeader) {
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": blob.type || mimeType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes"
      }
    });
  }

  const match = String(rangeHeader).match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": blob.type || mimeType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes"
      }
    });
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  const boundedEnd = Math.min(end, size - 1);
  const chunk = blob.slice(start, boundedEnd + 1, blob.type || mimeType);

  return new Response(chunk, {
    status: 206,
    headers: {
      "Content-Type": blob.type || mimeType,
      "Content-Length": String(chunk.size),
      "Content-Range": `bytes ${start}-${boundedEnd}/${size}`,
      "Accept-Ranges": "bytes"
    }
  });
}

async function cacheVideoStream(stream, meta) {
  const reader = stream.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    postProgress(meta, loaded);
  }

  const blob = new Blob(chunks, { type: meta.mimeType });
  await putCachedVideo({
    id: meta.episodeId,
    blob,
    title: meta.title,
    size: blob.size,
    cachedAt: Date.now()
  });

  postClient(meta.clientId, {
    type: "VIDEO_CACHE_DONE",
    episodeId: meta.episodeId,
    loaded: blob.size,
    total: blob.size,
    percent: 100
  });
  if (activeFetch.episodeId === meta.episodeId) {
    activeFetch = { episodeId: "", controller: null };
  }
}

function postProgress(meta, loaded) {
  const total = meta.total || 0;
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  postClient(meta.clientId, {
    type: "VIDEO_CACHE_PROGRESS",
    episodeId: meta.episodeId,
    loaded,
    total,
    percent
  });
}

async function postClient(clientId, message) {
  if (!clientId) return;
  const client = await self.clients.get(clientId);
  client?.postMessage(message);
}

function copyVideoHeaders(headers, mimeType) {
  const copied = new Headers();
  const keep = ["content-length", "content-range", "accept-ranges"];
  keep.forEach(name => {
    const value = headers.get(name);
    if (value) copied.set(name, value);
  });
  copied.set("Content-Type", headers.get("content-type") || mimeType);
  copied.set("Accept-Ranges", "bytes");
  return copied;
}

function totalBytesFromHeaders(headers) {
  const contentRange = headers.get("content-range");
  const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1];
  return Number(rangeTotal || headers.get("content-length") || 0);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const result = run(store);
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getCachedVideo(id) {
  return tx("readonly", store => store.get(id));
}

async function putCachedVideo(record) {
  return tx("readwrite", store => store.put(record));
}
