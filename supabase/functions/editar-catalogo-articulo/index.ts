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
  const rawArticles = Array.isArray(body.articles)
    ? body.articles.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [body.article && typeof body.article === "object"
      ? body.article as Record<string, unknown>
      : body];
  if (!rawArticles.length) return json({ error: "No hay articulos para guardar" }, 400);
  if (rawArticles.length > 250) return json({ error: "El lote supera el maximo de 250 articulos" }, 400);

  const editsByCode = new Map<string, ReturnType<typeof editPayload>>();
  for (const raw of rawArticles) {
    const edit = editPayload(raw, session.user_id);
    if (!edit.codigo) return json({ error: "Codigo de articulo requerido" }, 400);
    editsByCode.set(edit.codigo, edit);
  }
  const edits = [...editsByCode.values()];
  const codes = edits.map((edit) => edit.codigo);

  const { data: activeArticles, error: articleError } = await supabase
    .from("catalogo_articulos")
    .select("codigo")
    .in("codigo", codes)
    .eq("activo", true);
  if (articleError) return json({ error: articleError.message }, 500);
  const activeCodes = new Set((activeArticles || []).map((article) => String(article.codigo)));
  const missingCodes = codes.filter((code) => !activeCodes.has(code));
  if (missingCodes.length) {
    return json({
      error: "Uno o mas articulos no existen en el catalogo activo",
      codes: missingCodes,
    }, 404);
  }

  const { data: currentMeta, error: metaReadError } = await supabase
    .from("catalogo_articulos_meta")
    .select("*")
    .eq("id", "principal")
    .maybeSingle();
  if (metaReadError) return json({ error: metaReadError.message }, 500);
  const version = Math.max(Date.now(), Number(currentMeta?.version || 0) + 1);
  const versionedEdits = edits.map((edit) => ({ ...edit, sync_version: version }));

  const { error: editError } = await supabase
    .from("catalogo_articulos_edicion")
    .upsert(versionedEdits, { onConflict: "codigo" });
  if (editError) return json({ error: editError.message }, 500);
  const { error: metaWriteError } = await supabase.from("catalogo_articulos_meta").upsert({
    ...(currentMeta || {}),
    id: "principal",
    version,
    previous_version: Number(currentMeta?.version || 0) || null,
    change_mode: "delta",
    changed_codes: codes,
    removed_codes: [],
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (metaWriteError) return json({ error: metaWriteError.message }, 500);

  const { data: updated, error: updatedError } = await supabase
    .from("catalogo_articulos_publico")
    .select("*")
    .in("codigo", codes);
  if (updatedError) return json({ error: updatedError.message }, 500);
  const updatedByCode = new Map((updated || []).map((article) => [String(article.codigo), article]));
  const orderedUpdated = codes.map((code) => updatedByCode.get(code)).filter(Boolean);

  return json({
    ok: true,
    version,
    updated_by: session.user_name,
    article: orderedUpdated[0] || null,
    articles: orderedUpdated,
  });
});
