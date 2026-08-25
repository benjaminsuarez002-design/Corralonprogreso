import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_SHA256 = "84a93f41fa4a49dfd1a75458d68e2a6fcea801d1a9dfeeb77df58305d2cd4a4e";
const MAX_BATCH = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function nullableNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
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

function metadataRow(raw: unknown, updatedBy: string | null) {
  const row = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const codigo = text(row.codigo ?? row.idart ?? row.idArt);
  const imagenes = stringArray(row.imagenes ?? row.fotos);
  const fotoUrl = stringValue(row.fotoUrl ?? row.foto_url ?? row.imagen ?? imagenes[0]);
  if (fotoUrl && !imagenes.includes(fotoUrl)) imagenes.unshift(fotoUrl);
  return {
    codigo,
    detalle: stringValue(row.detalle),
    tags_ocultos: stringArray(row.tagsOcultos ?? row.tags_ocultos),
    foto_url: fotoUrl,
    imagenes,
    oferta: boolean(row.oferta),
    oferta_pct: Math.max(0, Math.min(100, number(row.ofertaPct ?? row.oferta_pct))),
    oferta_hasta: isoDate(row.ofertaHasta ?? row.oferta_hasta),
    destacado: boolean(row.destacado),
    mas_vendido: boolean(row.masVendido ?? row.mas_vendido),
    acceso_rapido: boolean(row.accesoRapido ?? row.acceso_rapido),
    ceramico: boolean(row.ceramico),
    ceramico_m2: Math.max(0, number(row.ceramicoM2 ?? row.ceramico_m2)),
    ceramico_placas: Math.max(0, Math.trunc(number(row.ceramicoPlacas ?? row.ceramico_placas))),
    updated_by: updatedBy,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || await sha256(token) !== TOKEN_SHA256) {
    return json({ error: "No autorizado" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Configuracion interna incompleta" }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "JSON invalido" }, 400);
  }

  const action = String(payload.action || "");
  const version = Math.trunc(number(payload.version));
  if (version <= 0) return json({ error: "Version invalida" }, 400);

  if (action === "batch" || action === "delta_batch") {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length || rows.length > MAX_BATCH) {
      return json({ error: `El lote debe contener entre 1 y ${MAX_BATCH} filas` }, 400);
    }
    const now = new Date().toISOString();
    const sourceFile = text(payload.source_file);
    const normalized = rows.map((raw) => {
      const row = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
      return {
        codigo: text(row.codigo),
        codigo_proveedor: text(row.codigo_proveedor),
        id_proveedor: text(row.id_proveedor),
        nombre: String(row.nombre ?? "").trim(),
        rubro: text(row.rubro),
        id_rubro: nullableNumber(row.id_rubro),
        precio_compra_sin_descuento: number(row.precio_compra_sin_descuento),
        precio_compra_con_impuestos: number(row.precio_compra_con_impuestos),
        porcentaje_ganancia_min: number(row.porcentaje_ganancia_min),
        precio_venta: number(row.precio_venta),
        stock: nullableNumber(row.stock),
        stock_progreso: nullableNumber(row.stock_progreso),
        stock_calle5: nullableNumber(row.stock_calle5),
        source_rows: Array.isArray(row.source_rows) ? row.source_rows : [],
        sync_version: version,
        source_file: sourceFile,
        activo: true,
        updated_at: now,
      };
    }).filter((row) => row.codigo);

    if (!normalized.length) return json({ error: "El lote no contiene codigos validos" }, 400);
    const { error } = await supabase.from("catalogo_articulos").upsert(normalized, { onConflict: "codigo" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, procesados: normalized.length, version });
  }

  if (action === "metadata_batch") {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length || rows.length > MAX_BATCH) {
      return json({ error: `El lote de metadatos debe contener entre 1 y ${MAX_BATCH} filas` }, 400);
    }
    const normalized = rows
      .map((row) => ({
        ...metadataRow(row, stringValue(payload.updated_by) || "migracion_cloudinary"),
        sync_version: version,
      }))
      .filter((row) => row.codigo);
    if (!normalized.length) return json({ error: "El lote no contiene codigos validos" }, 400);
    const { error } = await supabase
      .from("catalogo_articulos_edicion")
      .upsert(normalized, { onConflict: "codigo" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, procesados: normalized.length, version });
  }

  if (action === "metadata_finalize") {
    const { data: current, error: readError } = await supabase
      .from("catalogo_articulos_meta")
      .select("*")
      .eq("id", "principal")
      .maybeSingle();
    if (readError) return json({ error: readError.message }, 500);
    const { count, error: countError } = await supabase
      .from("catalogo_articulos_edicion")
      .select("codigo", { count: "exact", head: true });
    if (countError) return json({ error: countError.message }, 500);
    const { error } = await supabase.from("catalogo_articulos_meta").upsert({
      ...(current || {}),
      id: "principal",
      version: Math.max(version, Number(current?.version || 0) + 1),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, version, total_metadatos: count || 0 });
  }

  if (action === "delta_remove") {
    const removedCodes = Array.isArray(payload.removed_codes)
      ? [...new Set(payload.removed_codes.map((value) => stringValue(value)).filter(Boolean))]
      : [];
    if (removedCodes.length > MAX_BATCH) {
      return json({ error: `No se pueden desactivar mas de ${MAX_BATCH} codigos por lote` }, 400);
    }
    if (removedCodes.length) {
      const { error } = await supabase
        .from("catalogo_articulos")
        .update({
          activo: false,
          sync_version: version,
          updated_at: new Date().toISOString(),
        })
        .in("codigo", removedCodes);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true, desactivados: removedCodes.length, version });
  }

  if (action === "delta_finalize") {
    const totalArticulos = Math.max(0, Math.trunc(number(payload.total_articulos)));
    const totalFilasFuente = Math.max(0, Math.trunc(number(payload.total_filas_fuente)));
    const sourceFile = text(payload.source_file);
    const changedCodes = stringArray(payload.changed_codes);
    const removedCodes = stringArray(payload.removed_codes);
    if (changedCodes.length + removedCodes.length > 2500) {
      return json({ error: "El delta supera el maximo de 2500 codigos" }, 400);
    }

    const { data: current, error: readError } = await supabase
      .from("catalogo_articulos_meta")
      .select("version")
      .eq("id", "principal")
      .maybeSingle();
    if (readError) return json({ error: readError.message }, 500);

    const { count, error: countError } = await supabase
      .from("catalogo_articulos")
      .select("codigo", { count: "exact", head: true })
      .eq("activo", true);
    if (countError) return json({ error: countError.message }, 500);
    if (totalArticulos && count !== totalArticulos) {
      return json({ error: `Total activo inesperado: ${count || 0}; esperado: ${totalArticulos}` }, 409);
    }

    const { error: metaError } = await supabase.from("catalogo_articulos_meta").upsert({
      id: "principal",
      version,
      previous_version: Number(current?.version || 0) || null,
      change_mode: "delta",
      changed_codes: changedCodes,
      removed_codes: removedCodes,
      total_articulos: totalArticulos || count || 0,
      total_filas_fuente: totalFilasFuente,
      archivo_nombre: sourceFile,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (metaError) return json({ error: metaError.message }, 500);

    return json({
      ok: true,
      version,
      previous_version: Number(current?.version || 0) || null,
      modificados: changedCodes.length,
      desactivados: removedCodes.length,
      total_articulos: totalArticulos || count || 0,
    });
  }

  if (action === "finalize") {
    const totalArticulos = Math.max(0, Math.trunc(number(payload.total_articulos)));
    const totalFilasFuente = Math.max(0, Math.trunc(number(payload.total_filas_fuente)));
    const sourceFile = text(payload.source_file);

    const { count, error: countError } = await supabase
      .from("catalogo_articulos")
      .select("codigo", { count: "exact", head: true })
      .eq("sync_version", version)
      .eq("activo", true);
    if (countError) return json({ error: countError.message }, 500);
    if (!count) return json({ error: "La version no contiene articulos importados" }, 409);

    const { error: deactivateError } = await supabase
      .from("catalogo_articulos")
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq("activo", true)
      .neq("sync_version", version);
    if (deactivateError) return json({ error: deactivateError.message }, 500);

    const { error: metaError } = await supabase.from("catalogo_articulos_meta").upsert({
      id: "principal",
      version,
      last_full_version: version,
      previous_version: null,
      change_mode: "full",
      changed_codes: [],
      removed_codes: [],
      total_articulos: totalArticulos || count,
      total_filas_fuente: totalFilasFuente,
      archivo_nombre: sourceFile,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (metaError) return json({ error: metaError.message }, 500);

    return json({ ok: true, version, total_articulos: totalArticulos || count });
  }

  return json({ error: "Accion invalida" }, 400);
});
