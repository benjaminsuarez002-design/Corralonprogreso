import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Metodo no permitido", { status: 405, headers: cors });

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

    let result = await supabase.from("caja_publicaciones").upsert({
      fecha,
      version,
      source_hash: String(body.sourceHash || ""),
      movimientos: body.movimientos || {},
      ingresos_egresos: body.ingresosEgresos || {},
      recibos: body.recibos || {},
      updated_at: new Date().toISOString(),
    }, { onConflict: "fecha" });
    if (result.error) throw result.error;

    result = await supabase.from("caja_transferencias_sistema")
      .update({ source_present: false, updated_at: new Date().toISOString() })
      .eq("fecha", fecha)
      .eq("source", "imported");
    if (result.error) throw result.error;

    const rows = (Array.isArray(body.transferencias) ? body.transferencias : []).map((row, index) => ({
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
      source_present: true,
      import_version: version,
      updated_at: new Date().toISOString(),
    }));
    if (rows.length) {
      result = await supabase.from("caja_transferencias_sistema")
        .upsert(rows, { onConflict: "id" });
      if (result.error) throw result.error;
    }

    return new Response(JSON.stringify({ ok: true, fecha, version, filas: rows.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
