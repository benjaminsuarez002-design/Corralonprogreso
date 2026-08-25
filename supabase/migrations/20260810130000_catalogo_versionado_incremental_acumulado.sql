alter table public.catalogo_articulos_edicion
  add column if not exists sync_version bigint not null default 0;

update public.catalogo_articulos_edicion e
set sync_version = coalesce(b.sync_version, 0)
from public.catalogo_articulos b
where b.codigo = e.codigo
  and e.sync_version = 0;

alter table public.catalogo_articulos_meta
  add column if not exists last_full_version bigint not null default 0;

update public.catalogo_articulos_meta m
set last_full_version = coalesce(
  (
    select ranked.sync_version
    from (
      select a.sync_version, count(*) as cantidad
      from public.catalogo_articulos a
      where a.activo is true and a.sync_version > 0
      group by a.sync_version
      order by cantidad desc, a.sync_version desc
      limit 1
    ) ranked
  ),
  m.version
)
where m.id = 'principal'
  and m.last_full_version = 0;

create index if not exists catalogo_articulos_sync_version_idx
  on public.catalogo_articulos (sync_version);

create index if not exists catalogo_articulos_edicion_sync_version_idx
  on public.catalogo_articulos_edicion (sync_version);

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
  e.updated_at as edicion_updated_at
from public.catalogo_articulos b
left join public.catalogo_articulos_edicion e on e.codigo = b.codigo;

grant select on public.catalogo_articulos_publico to anon, authenticated;
