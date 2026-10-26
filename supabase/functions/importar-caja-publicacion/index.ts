import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function comparableTransfer(row: Record<string, unknown>) {
  return JSON.stringify({
    source_key: String(row.source_key || ""),
    tipo_comp: String(row.tipo_comp || ""),
    nro_factura: String(row.nro_factura || ""),
    cliente: String(row.cliente || ""),
    monto: Number(row.monto || 0),
    tipo_pago: String(row.tipo_pago || "Transf Bria."),
    orden: Number(row.orden || 0),
    source_present: row.source_present !== false,
    deleted: Boolean(row.deleted),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return new Response("Metodo no permitido", { status: 405, headers: cors });

  try {
    const body = await req.json();
    const fecha = String(body.fecha || "");
    const version = Number(body.version || Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < "2026-07-29") {
      throw new Error("Fecha de Caja invalida");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const hashes =
      body.sectionHashes && typeof body.sectionHashes === "object"
        ? body.sectionHashes
        : {};
    const movimientosHash = String(hashes.movimientos || body.sourceHash || "");
    const ingresosEgresosHash = String(
      hashes.ingresosEgresos || body.sourceHash || "",
    );
    const recibosHash = String(hashes.recibos || body.sourceHash || "");
    const transferenciasHash = String(
      hashes.transferencias || body.sourceHash || "",
    );
    const now = new Date().toISOString();

    const publicationResult = await supabase
      .from("caja_publicaciones")
      .select(
        "version,movimientos_version,ingresos_egresos_version,recibos_version,transferencias_version,movimientos_hash,ingresos_egresos_hash,recibos_hash,transferencias_hash",
      )
      .eq("fecha", fecha)
      .maybeSingle();
    if (publicationResult.error) throw publicationResult.error;
    const previous = publicationResult.data;

    const existingResult = await supabase
      .from("caja_transferencias_sistema")
      .select("*")
      .eq("fecha", fecha)
      .eq("source", "imported");
    if (existingResult.error) throw existingResult.error;
    const existingRows = Array.isArray(existingResult.data)
      ? existingResult.data
      : [];
    const existingById = new Map(
      existingRows.map((row) => [String(row.id), row]),
    );

    const rows = (
      Array.isArray(body.transferencias) ? body.transferencias : []
    ).map((row, index) => ({
      id: `${fecha}|${String(row.source_key || index)}`,
      fecha,
      source_key: String(row.source_key || index),
      source: "imported",
      tipo_comp: String(row.type_comp || ""),
      nro_factura: String(row.nro_factura || ""),
      cliente: String(row.cliente || ""),
      monto: Number(row.monto || 0),
      tipo_pago: String(row.tipo_pago || "Transf Bria."),
      orden: Number(row.orden ?? index),
      deleted: false,
      source_present: true,
      import_version: version,
      idversion: version,
      updated_at: now,
    }));

    const incomingIds = new Set(rows.map((row) => row.id));
    const changedRows = rows.filter((row) => {
      const current = existingById.get(row.id);
      return (
        !current || comparableTransfer(current) !== comparableTransfer(row)
      );
    });
    const removedIds = existingRows
      .filter(
        (row) =>
          row.source_present !== false && !incomingIds.has(String(row.id)),
      )
      .map((row) => String(row.id));
    const transferenciasChanged =
      changedRows.length > 0 || removedIds.length > 0;

    if (changedRows.length) {
      const result = await supabase
        .from("caja_transferencias_sistema")
        .upsert(changedRows, { onConflict: "id" });
      if (result.error) throw result.error;
    }
    if (removedIds.length) {
      const result = await supabase
        .from("caja_transferencias_sistema")
        .update({
          source_present: false,
          idversion: version,
          import_version: version,
          updated_at: now,
        })
        .eq("fecha", fecha)
        .in("id", removedIds);
      if (result.error) throw result.error;
    }

    const movimientosChanged =
      !previous || String(previous.movimientos_hash || "") !== movimientosHash;
    const ingresosEgresosChanged =
      !previous ||
      String(previous.ingresos_egresos_hash || "") !== ingresosEgresosHash;
    const recibosChanged =
      !previous || String(previous.recibos_hash || "") !== recibosHash;
    const anyChanged =
      movimientosChanged ||
      ingresosEgresosChanged ||
      recibosChanged ||
      transferenciasChanged;

    if (!anyChanged) {
      return new Response(
        JSON.stringify({
          ok: true,
          fecha,
          version: Number(previous?.version || 0),
          sinCambios: true,
          filas: rows.length,
        }),
        {
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const publicationPayload: Record<string, unknown> = {
      fecha,
      version,
      source_hash: String(body.sourceHash || ""),
      movimientos_version: movimientosChanged
        ? version
        : Number(previous?.movimientos_version || 0),
      ingresos_egresos_version: ingresosEgresosChanged
        ? version
        : Number(previous?.ingresos_egresos_version || 0),
      recibos_version: recibosChanged
        ? version
        : Number(previous?.recibos_version || 0),
      transferencias_version: transferenciasChanged
        ? version
        : Number(previous?.transferencias_version || 0),
      movimientos_hash: movimientosHash,
      ingresos_egresos_hash: ingresosEgresosHash,
      recibos_hash: recibosHash,
      transferencias_hash: transferenciasHash,
      updated_at: now,
    };
    if (movimientosChanged)
      publicationPayload.movimientos = body.movimientos || {};
    if (ingresosEgresosChanged)
      publicationPayload.ingresos_egresos = body.ingresosEgresos || {};
    if (recibosChanged) publicationPayload.recibos = body.recibos || {};
    const savePublication = await supabase
      .from("caja_publicaciones")
      .upsert(publicationPayload, { onConflict: "fecha" });
    if (savePublication.error) throw savePublication.error;

    return new Response(
      JSON.stringify({
        ok: true,
        fecha,
        version,
        filas: rows.length,
        cambios: {
          movimientos: movimientosChanged,
          ingresosEgresos: ingresosEgresosChanged,
          recibos: recibosChanged,
          transferencias: transferenciasChanged,
        },
      }),
      {
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: String(error?.message || error) }),
      {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }
});
