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
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < "2026-07-29" || fecha > today) {
      throw new Error("Fecha fuera del periodo editable");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const action = String(body.action || "");
    let result;

    if (action === "upsert") {
      const rows = (Array.isArray(body.rows) ? body.rows : []).map((row) => ({
        id: String(row.id),
        fecha,
        source_key: String(row.source_key || row.id),
        source: row.source === "manual" ? "manual" : "imported",
        tipo_comp: String(row.tipo_comp || ""),
        nro_factura: String(row.nro_factura || ""),
        cliente: String(row.cliente || ""),
        monto: Number(row.monto || 0),
        tipo_pago: String(row.tipo_pago || "Transf Bria."),
        orden: Number(row.orden || 0),
        merge_group: row.merge_group ? String(row.merge_group) : null,
        deleted: false,
        source_present: true,
        updated_at: new Date().toISOString(),
      }));
      result = rows.length
        ? await supabase.from("caja_transferencias_sistema").upsert(rows, { onConflict: "id" })
        : { error: null };
    } else if (action === "soft_delete") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String);
      result = ids.length
        ? await supabase.from("caja_transferencias_sistema")
          .update({ deleted: true, updated_at: new Date().toISOString() })
          .eq("fecha", fecha)
          .in("id", ids)
        : { error: null };
    } else if (action === "merge") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String);
      result = ids.length
        ? await supabase.from("caja_transferencias_sistema")
          .update({
            merge_group: body.mergeGroup ? String(body.mergeGroup) : null,
            updated_at: new Date().toISOString(),
          })
          .eq("fecha", fecha)
          .in("id", ids)
        : { error: null };
    } else if (action === "clear_date") {
      result = await supabase.from("caja_transferencias_sistema").delete().eq("fecha", fecha);
    } else {
      throw new Error("Accion no valida");
    }

    if (result.error) throw result.error;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
