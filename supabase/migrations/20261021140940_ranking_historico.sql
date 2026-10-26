-- Importes y puntaje calculados en SQL Server/PowerShell antes de publicar.
alter table public.ranking_articulos_4m
  add column if not exists importe_progreso numeric(22,6) not null default 0,
  add column if not exists importe_calle5 numeric(22,6) not null default 0,
  add column if not exists puntaje numeric(24,6) not null default 0;

-- Mantener la lectura pública del resumen y la escritura sólo del publicador.
alter table public.ranking_articulos_4m enable row level security;
drop policy if exists ranking_lectura_publica on public.ranking_articulos_4m;
create policy ranking_lectura_publica on public.ranking_articulos_4m for select to anon, authenticated using (true);

create or replace function public.publicar_ranking_articulos_4m(
  p_rows jsonb,
  p_desde date,
  p_hasta date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version bigint;
  v_cambiados integer := 0;
  v_ceros integer := 0;
  v_total integer := 0;
  v_desde_anterior date;
  v_hasta_anterior date;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 25000
     or exists (select 1 from jsonb_array_elements(p_rows) r where not (r ?& array['importe_progreso','importe_calle5','puntaje']))
     or p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Snapshot de ranking invalido';
  end if;

  select ranking_version + 1, ranking_desde, ranking_hasta
    into v_version, v_desde_anterior, v_hasta_anterior
  from public.catalogo_articulos_meta where id = 'principal' for update;
  if v_version is null then raise exception 'Falta catalogo_articulos_meta principal'; end if;

  create temporary table ranking_snapshot_actual on commit drop as
  select trim(r.idart) as idart,
         greatest(0, coalesce(r.ventas_progreso, 0)) as ventas_progreso,
         coalesce(r.unidades_progreso, 0)::numeric(18,3) as unidades_progreso,
         greatest(0, coalesce(r.ventas_calle5, 0)) as ventas_calle5,
         coalesce(r.unidades_calle5, 0)::numeric(18,3) as unidades_calle5,
         coalesce(r.importe_progreso, 0)::numeric(22,6) as importe_progreso,
         coalesce(r.importe_calle5, 0)::numeric(22,6) as importe_calle5,
         greatest(0, coalesce(r.puntaje, 0))::numeric(24,6) as puntaje,
         r.ultima_venta
  from jsonb_to_recordset(p_rows) as r(
    idart text, ventas_progreso integer, unidades_progreso numeric,
    ventas_calle5 integer, unidades_calle5 numeric, ultima_venta date,
    importe_progreso numeric, importe_calle5 numeric, puntaje numeric
  );
  if exists (select 1 from pg_temp.ranking_snapshot_actual where idart is null or idart = '')
     or exists (select idart from pg_temp.ranking_snapshot_actual group by idart having count(*) > 1) then
    raise exception 'IDArt vacio o repetido en ranking';
  end if;
  select count(*) into v_total from pg_temp.ranking_snapshot_actual;

  insert into public.ranking_articulos_4m as old
    (idart, ventas_progreso, unidades_progreso, ventas_calle5,
     unidades_calle5, ultima_venta, importe_progreso, importe_calle5, puntaje, sync_version)
  select idart, ventas_progreso, unidades_progreso, ventas_calle5,
         unidades_calle5, ultima_venta, importe_progreso, importe_calle5, puntaje, v_version
  from pg_temp.ranking_snapshot_actual
  on conflict (idart) do update set
    ventas_progreso = excluded.ventas_progreso,
    unidades_progreso = excluded.unidades_progreso,
    ventas_calle5 = excluded.ventas_calle5,
    unidades_calle5 = excluded.unidades_calle5,
    ultima_venta = excluded.ultima_venta,
    importe_progreso = excluded.importe_progreso,
    importe_calle5 = excluded.importe_calle5,
    puntaje = excluded.puntaje,
    sync_version = excluded.sync_version
  where (old.ventas_progreso, old.unidades_progreso, old.ventas_calle5,
         old.unidades_calle5, old.ultima_venta, old.importe_progreso, old.importe_calle5, old.puntaje)
    is distinct from
        (excluded.ventas_progreso, excluded.unidades_progreso,
         excluded.ventas_calle5, excluded.unidades_calle5, excluded.ultima_venta,
         excluded.importe_progreso, excluded.importe_calle5, excluded.puntaje);
  get diagnostics v_cambiados = row_count;

  update public.ranking_articulos_4m as old set
    ventas_progreso = 0, unidades_progreso = 0,
    ventas_calle5 = 0, unidades_calle5 = 0,
    importe_progreso = 0, importe_calle5 = 0, puntaje = 0,
    ultima_venta = null, sync_version = v_version
  where not exists (select 1 from pg_temp.ranking_snapshot_actual as fresh where fresh.idart = old.idart)
    and (old.ventas_progreso <> 0 or old.unidades_progreso <> 0
      or old.ventas_calle5 <> 0 or old.unidades_calle5 <> 0 or old.ultima_venta is not null
      or old.importe_progreso <> 0 or old.importe_calle5 <> 0 or old.puntaje <> 0);
  get diagnostics v_ceros = row_count;

  if v_cambiados = 0 and v_ceros = 0
     and v_desde_anterior = p_desde and v_hasta_anterior = p_hasta then
    return jsonb_build_object('version', v_version - 1, 'articulos', v_total,
                              'modificados', 0, 'puestos_en_cero', 0);
  end if;

  update public.catalogo_articulos_meta set
    ranking_version = v_version,
    ranking_desde = p_desde,
    ranking_hasta = p_hasta,
    ranking_actualizado_at = now()
  where id = 'principal';
  return jsonb_build_object('version', v_version, 'articulos', v_total,
                            'modificados', v_cambiados, 'puestos_en_cero', v_ceros);
end;
$$;

revoke all on function public.publicar_ranking_articulos_4m(jsonb, date, date) from public, anon, authenticated;
grant execute on function public.publicar_ranking_articulos_4m(jsonb, date, date) to service_role;
