import { createClient } from "npm:@supabase/supabase-js@2";

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

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function boolean(value: unknown) {
  if (value === true || value === 1) return true;
  return ["1", "true", "si", "sí", "x"].includes(String(value ?? "").trim().toLowerCase());
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function isoDate(value: unknown) {
  const result = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function editPayload(raw: Record<string, unknown>, userId: string) {
  const imagenes = stringArray(raw.imagenes ?? raw.fotos);
  const fotoUrl = stringValue(raw.fotoUrl ?? raw.foto_url ?? raw.imagen ?? imagenes[0]);
  if (fotoUrl && !imagenes.includes(fotoUrl)) imagenes.unshift(fotoUrl);
  return {
    codigo: stringValue(raw.codigo ?? raw.idart ?? raw.idArt),
    detalle: stringValue(raw.detalle),
    tags_ocultos: stringArray(raw.tagsOcultos ?? raw.tags_ocultos),
    foto_url: fotoUrl,
    imagenes,
    oferta: boolean(raw.oferta),
    oferta_pct: Math.max(0, Math.min(100, number(raw.ofertaPct ?? raw.oferta_pct))),
    oferta_hasta: isoDate(raw.ofertaHasta ?? raw.oferta_hasta),
    destacado: boolean(raw.destacado),
    mas_vendido: boolean(raw.masVendido ?? raw.mas_vendido),
    acceso_rapido: boolean(raw.accesoRapido ?? raw.acceso_rapido),
    ceramico: boolean(raw.ceramico),
    ceramico_m2: Math.max(0, number(raw.ceramicoM2 ?? raw.ceramico_m2)),
    ceramico_placas: Math.max(0, Math.trunc(number(raw.ceramicoPlacas ?? raw.ceramico_placas))),
    updated_by: userId,
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

  const authorization = stringValue(request.headers.get("authorization"));
  const sessionToken = authorization.replace(/^Bearer\s+/i, "");
  if (!sessionToken || sessionToken.length > 512) return json({ error: "Sesion de edicion requerida" }, 401);
  const sessionHash = await sha256(sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from("catalogo_editor_sesiones")
    .select("token_hash,user_id,user_name,user_level,expires_at")
    .eq("token_hash", sessionHash)
    .maybeSingle();
  if (sessionError) return json({ error: sessionError.message }, 500);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session) await supabase.from("catalogo_editor_sesiones").delete().eq("token_hash", sessionHash);
    return json({ error: "La sesion de edicion vencio. Volve a iniciar sesion.", code: "editor_session_expired" }, 401);
  }
  await supabase.from("catalogo_editor_sesiones").update({
    last_used_at: new Date().toISOString(),
  }).eq("token_hash", sessionHash);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalido" }, 400);
  }
  const raw = body.article && typeof body.article === "object"
    ? body.article as Record<string, unknown>
    : body;
  const edit = editPayload(raw, session.user_id);
  if (!edit.codigo) return json({ error: "Codigo de articulo requerido" }, 400);

  const { data: article, error: articleError } = await supabase
    .from("catalogo_articulos")
    .select("codigo")
    .eq("codigo", edit.codigo)
    .eq("activo", true)
    .maybeSingle();
  if (articleError) return json({ error: articleError.message }, 500);
  if (!article) return json({ error: "El articulo no existe en el catalogo activo" }, 404);

  const { error: editError } = await supabase
    .from("catalogo_articulos_edicion")
    .upsert(edit, { onConflict: "codigo" });
  if (editError) return json({ error: editError.message }, 500);

  const { data: currentMeta, error: metaReadError } = await supabase
    .from("catalogo_articulos_meta")
    .select("*")
    .eq("id", "principal")
    .maybeSingle();
  if (metaReadError) return json({ error: metaReadError.message }, 500);
  const version = Math.max(Date.now(), Number(currentMeta?.version || 0) + 1);
  const { error: metaWriteError } = await supabase.from("catalogo_articulos_meta").upsert({
    ...(currentMeta || {}),
    id: "principal",
    version,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (metaWriteError) return json({ error: metaWriteError.message }, 500);

  const { data: updated, error: updatedError } = await supabase
    .from("catalogo_articulos_publico")
    .select("*")
    .eq("codigo", edit.codigo)
    .maybeSingle();
  if (updatedError) return json({ error: updatedError.message }, 500);

  return json({
    ok: true,
    version,
    updated_by: session.user_name,
    article: updated,
  });
});
