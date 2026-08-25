import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-menu-user-level, x-menu-user-id",
  "access-control-allow-methods": "POST, OPTIONS",
};
const MAX_BATCH = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function text(value: unknown) { return String(value ?? "").trim(); }
function number(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function nullableNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Configuracion interna incompleta" }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = text(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "Sesion de administrador requerida" }, 401);
  const tokenHash = await sha256(bearer);
  const { data: storedSession, error: sessionError } = await supabase
    .from("catalogo_editor_sesiones")
    .select("user_id,user_name,user_level,expires_at")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (sessionError) return json({ error: sessionError.message }, 500);

  const level = text(storedSession?.user_level).toLowerCase();
  if (!storedSession || !(level.includes("admin") || level.includes("administrador"))) {
    return json({ error: "Solo un administrador puede sincronizar el catalogo" }, 403);
  }

  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return json({ error: "JSON invalido" }, 400); }
  const action = text(payload.action);
  const version = Math.trunc(number(payload.version));
  if (version <= 0) return json({ error: "Version invalida" }, 400);

  if (action === "batch") {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length || rows.length > MAX_BATCH) return json({ error: `El lote debe contener entre 1 y ${MAX_BATCH} filas` }, 400);
    const now = new Date().toISOString();
    const sourceFile = text(payload.source_file) || null;
    const normalizedRows = rows.map((raw) => {
      const row = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
      return {
        codigo: text(row.codigo),
        codigo_proveedor: text(row.codigo_proveedor) || null,
        id_proveedor: text(row.id_proveedor) || null,
        nombre: text(row.nombre),
        rubro: text(row.rubro) || null,
        id_rubro: nullableNumber(row.id_rubro),
        precio_compra_sin_descuento: number(row.precio_compra_sin_descuento),
        precio_compra_con_impuestos: number(row.precio_compra_con_impuestos),
        porcentaje_ganancia_min: number(row.porcentaje_ganancia_min),
        precio_venta: number(row.precio_venta),
        stock: nullableNumber(row.stock),
        stock_progreso: nullableNumber(row.stock_progreso),
        stock_calle5: nullableNumber(row.stock_calle5),
        idsuc: text(row.idsuc) || null,
        source_rows: Array.isArray(row.source_rows) ? row.source_rows : [],
        sync_version: version,
        source_file: sourceFile,
        activo: true,
        updated_at: now,
      };
    }).filter((row) => row.codigo);
    // Un mismo artículo puede venir una vez por sucursal. Se consolida por
    // código sin perder el stock: idsuc=1 es Progreso e idsuc=2 es Calle 5.
    const normalizedByCode = new Map<string, any>();
    for (const row of normalizedRows) {
      if (row.idsuc === "1" && row.stock !== null) row.stock_progreso = row.stock;
      if (row.idsuc === "2" && row.stock !== null) row.stock_calle5 = row.stock;
      const previous = normalizedByCode.get(row.codigo);
      if (!previous) {
        normalizedByCode.set(row.codigo, row);
        continue;
      }
      const merged = { ...previous, ...row, source_rows: [...(previous.source_rows || []), ...(row.source_rows || [])] };
      merged.stock_progreso = row.stock_progreso !== null ? row.stock_progreso : previous.stock_progreso;
      merged.stock_calle5 = row.stock_calle5 !== null ? row.stock_calle5 : previous.stock_calle5;
      if (row.idsuc === "1" && row.stock !== null) merged.stock_progreso = row.stock;
      if (row.idsuc === "2" && row.stock !== null) merged.stock_calle5 = row.stock;
      normalizedByCode.set(row.codigo, merged);
    }
    // `idsuc` sirve solamente para consolidar las dos filas del Excel. No es
    // una columna de catalogo_articulos y no debe formar parte del upsert.
    const normalized = [...normalizedByCode.values()].map(({ idsuc: _idsuc, ...row }) => row);
    if (!normalized.length) return json({ error: "El lote no contiene codigos validos" }, 400);
    const { error } = await supabase.from("catalogo_articulos").upsert(normalized, { onConflict: "codigo" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, procesados: normalized.length, version });
  }

  if (action === "finalize") {
    const total = Math.max(0, Math.trunc(number(payload.total_articulos)));
    const sourceFile = text(payload.source_file) || null;
    const { count, error: countError } = await supabase.from("catalogo_articulos")
      .select("codigo", { count: "exact", head: true }).eq("sync_version", version).eq("activo", true);
    if (countError) return json({ error: countError.message }, 500);
    if (!count) return json({ error: "La version no contiene articulos importados" }, 409);
    const { error: deactivateError } = await supabase.from("catalogo_articulos")
      .update({ activo: false, updated_at: new Date().toISOString() }).eq("activo", true).neq("sync_version", version);
    if (deactivateError) return json({ error: deactivateError.message }, 500);
    const { data: current } = await supabase.from("catalogo_articulos_meta").select("version").eq("id", "principal").maybeSingle();
    const { error: metaError } = await supabase.from("catalogo_articulos_meta").upsert({
      id: "principal", version, last_full_version: version, previous_version: Number(current?.version || 0) || null,
      change_mode: "full", changed_codes: [], removed_codes: [], total_articulos: total || count,
      total_filas_fuente: Math.max(0, Math.trunc(number(payload.total_filas_fuente))),
      archivo_nombre: sourceFile, updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (metaError) return json({ error: metaError.message }, 500);
    return json({ ok: true, version, total_articulos: total || count, updated_by: storedSession.user_name });
  }
  return json({ error: "Accion invalida" }, 400);
});
