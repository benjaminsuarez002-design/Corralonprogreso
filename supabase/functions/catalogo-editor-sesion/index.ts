import { createClient } from "npm:@supabase/supabase-js@2";

const FIRESTORE_PROJECT = "corralon-progreso";
const FIRESTORE_API_KEY = "AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0";
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function firestoreValue(field: unknown): unknown {
  if (!field || typeof field !== "object") return "";
  const value = field as Record<string, unknown>;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return value.integerValue;
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  return "";
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sameSecret(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = leftHash.length ^ rightHash.length;
  const max = Math.max(leftHash.length, rightHash.length);
  for (let index = 0; index < max; index += 1) {
    difference |= (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function fetchMenuUser(userId: string) {
  if (!userId || userId.length > 160) return { user: null, status: 400 };
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/menuUsuarios/${encodeURIComponent(userId)}?key=${FIRESTORE_API_KEY}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return { user: null, status: response.status };
  const payload = await response.json();
  const fields = payload?.fields || {};
  return {
    status: 200,
    user: {
      id: userId,
      nombre: text(firestoreValue(fields.nombre)) || text(firestoreValue(fields.usuario)) || userId,
      usuario: text(firestoreValue(fields.usuario)),
      password: String(firestoreValue(fields.password) ?? ""),
      nivel: text(firestoreValue(fields.nivel)),
    },
  };
}

function snapshotMenuUser(value: unknown, userId: string) {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Record<string, unknown>;
  if (text(snapshot.id) !== userId) return null;
  const password = String(snapshot.password ?? "");
  if (!password) return null;
  return {
    id: userId,
    nombre: text(snapshot.nombre) || text(snapshot.usuario) || userId,
    usuario: text(snapshot.usuario),
    password,
    nivel: text(snapshot.nivel),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Configuracion interna incompleta" }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalido" }, 400);
  }

  const action = text(body.action || "login").toLowerCase();
  if (action === "logout") {
    const authorization = text(request.headers.get("authorization"));
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (token) await supabase.from("catalogo_editor_sesiones").delete().eq("token_hash", await sha256(token));
    return json({ ok: true });
  }
  if (action !== "login") return json({ error: "Accion no valida" }, 400);

  const userId = text(body.userId ?? body.user_id);
  const password = String(body.password ?? "");
  const firestoreResult = await fetchMenuUser(userId);
  let user = firestoreResult.user;
  if (!user && firestoreResult.status === 429) {
    user = snapshotMenuUser(body.userSnapshot, userId);
  }
  if (!user || !password || !(await sameSecret(password, user.password))) {
    return json({ error: "Usuario o clave no validos" }, 401);
  }

  const persistent = body.persistent === true;
  const durationMs = persistent ? 30 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + durationMs);
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(tokenBytes);
  const tokenHash = await sha256(token);

  await supabase.from("catalogo_editor_sesiones").delete().lt("expires_at", new Date().toISOString());
  const { error } = await supabase.from("catalogo_editor_sesiones").insert({
    token_hash: tokenHash,
    user_id: user.id,
    user_name: user.nombre,
    user_level: user.nivel,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return json({ error: error.message }, 500);

  return json({
    ok: true,
    token,
    expiresAt: expiresAt.getTime(),
    user: { id: user.id, nombre: user.nombre, nivel: user.nivel },
  });
});
