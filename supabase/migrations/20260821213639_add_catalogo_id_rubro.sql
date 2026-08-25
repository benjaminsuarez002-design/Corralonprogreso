alter table public.catalogo_articulos
  add column if not exists id_rubro integer;

with rubros_extraidos as (
  select
    codigo,
    coalesce(
      source_rows -> 0 ->> 'IDRubro',
      source_rows -> 0 ->> 'idrubro',
      source_rows -> 0 ->> 'id_rubro'
    ) as id_rubro_texto
  from public.catalogo_articulos
  where id_rubro is null
    and jsonb_typeof(source_rows) = 'array'
    and jsonb_array_length(source_rows) > 0
)
update public.catalogo_articulos as articulos
set id_rubro = rubros.id_rubro_texto::integer
from rubros_extraidos as rubros
where articulos.codigo = rubros.codigo
  and rubros.id_rubro_texto ~ '^[0-9]+$';

create index if not exists catalogo_articulos_id_rubro_idx
  on public.catalogo_articulos (id_rubro);

create or replace view public.catalogo_articulos_publico
with (security_invoker = true)
as
select
  b.codigo,
  b.codigo_proveedor,
  b.id_proveedor,
  b.nombre,
  b.rubro,
  b.precio_compra_sin_descuento,
  b.precio_compra_con_impuestos,
  b.porcentaje_ganancia_min,
  b.precio_venta,
  b.stock,
  b.stock_progreso,
  b.stock_calle5,
  b.source_rows,
  greatest(coalesce(b.sync_version, 0), coalesce(e.sync_version, 0)) as sync_version,
  b.source_file,
  b.activo,
  b.created_at,
  b.updated_at,
  coalesce(e.detalle, ''::text) as detalle,
  coalesce(e.tags_ocultos, '[]'::jsonb) as tags_ocultos,
  coalesce(e.foto_url, ''::text) as foto_url,
  coalesce(e.imagenes, '[]'::jsonb) as imagenes,
  coalesce(e.oferta, false) as oferta,
  coalesce(e.oferta_pct, 0::numeric) as oferta_pct,
  e.oferta_hasta,
  coalesce(e.destacado, false) as destacado,
  coalesce(e.mas_vendido, false) as mas_vendido,
  coalesce(e.acceso_rapido, false) as acceso_rapido,
  coalesce(e.ceramico, false) as ceramico,
  coalesce(e.ceramico_m2, 0::numeric) as ceramico_m2,
  coalesce(e.ceramico_placas, 0) as ceramico_placas,
  e.updated_by as editado_por,
  e.updated_at as edicion_updated_at,
  b.id_rubro
from public.catalogo_articulos b
left join public.catalogo_articulos_edicion e on e.codigo = b.codigo;

grant select on public.catalogo_articulos_publico to anon, authenticated;

create or replace function private.catalogo_registrar_cambio_base()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  anterior jsonb := '{}'::jsonb;
  actual jsonb := '{}'::jsonb;
  parche jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    insert into public.catalogo_articulos_cambios (codigo, cambios, eliminado, origen)
    values (old.codigo, jsonb_build_object('activo', false), true, 'catalogo_articulos');
    return old;
  end if;

  actual := jsonb_build_object(
    'codigo_proveedor', new.codigo_proveedor,
    'id_proveedor', new.id_proveedor,
    'nombre', new.nombre,
    'rubro', new.rubro,
    'id_rubro', new.id_rubro,
    'precio_compra_sin_descuento', new.precio_compra_sin_descuento,
    'precio_compra_con_impuestos', new.precio_compra_con_impuestos,
    'porcentaje_ganancia_min', new.porcentaje_ganancia_min,
    'precio_venta', new.precio_venta,
    'stock', new.stock,
    'stock_progreso', new.stock_progreso,
    'stock_calle5', new.stock_calle5,
    'activo', new.activo
  );

  if tg_op = 'UPDATE' then
    anterior := jsonb_build_object(
      'codigo_proveedor', old.codigo_proveedor,
      'id_proveedor', old.id_proveedor,
      'nombre', old.nombre,
      'rubro', old.rubro,
      'id_rubro', old.id_rubro,
      'precio_compra_sin_descuento', old.precio_compra_sin_descuento,
      'precio_compra_con_impuestos', old.precio_compra_con_impuestos,
      'porcentaje_ganancia_min', old.porcentaje_ganancia_min,
      'precio_venta', old.precio_venta,
      'stock', old.stock,
      'stock_progreso', old.stock_progreso,
      'stock_calle5', old.stock_calle5,
      'activo', old.activo
    );
  end if;

  select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
    into parche
  from jsonb_each(actual) as item
  where (anterior -> item.key) is distinct from item.value;

  if parche <> '{}'::jsonb then
    insert into public.catalogo_articulos_cambios (codigo, cambios, eliminado, origen)
    values (new.codigo, parche, false, 'catalogo_articulos');
  end if;

  return new;
end;
$$;

revoke all on function private.catalogo_registrar_cambio_base() from public, anon, authenticated;
