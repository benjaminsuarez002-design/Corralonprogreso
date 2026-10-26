create extension if not exists unaccent with schema extensions;

create or replace function public.buscar_catalogo_publico_reducido(
  p_termino text default '',
  p_codigos text[] default array[]::text[],
  p_portada boolean default false,
  p_limite integer default 400
)
returns table (
  codigo text,
  codigo_proveedor text,
  nombre text,
  rubro text,
  id_rubro integer,
  precio_venta numeric,
  stock numeric,
  stock_progreso numeric,
  stock_calle5 numeric,
  sync_version bigint,
  detalle text,
  tags_ocultos jsonb,
  foto_url text,
  imagenes jsonb,
  oferta boolean,
  oferta_pct numeric,
  oferta_hasta date,
  destacado boolean,
  mas_vendido boolean,
  acceso_rapido boolean,
  ceramico boolean,
  ceramico_m2 numeric,
  ceramico_placas integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with parametros as (
    select
      trim(lower(extensions.unaccent(coalesce(p_termino, '')))) as termino,
      coalesce(p_codigos, array[]::text[]) as codigos,
      greatest(1, least(coalesce(p_limite, 400), 600)) as limite
  )
  select
    a.codigo,
    a.codigo_proveedor,
    a.nombre,
    a.rubro,
    a.id_rubro,
    a.precio_venta,
    a.stock,
    a.stock_progreso,
    a.stock_calle5,
    a.sync_version,
    a.detalle,
    a.tags_ocultos,
    a.foto_url,
    a.imagenes,
    a.oferta,
    a.oferta_pct,
    a.oferta_hasta,
    a.destacado,
    a.mas_vendido,
    a.acceso_rapido,
    a.ceramico,
    a.ceramico_m2,
    a.ceramico_placas
  from public.catalogo_articulos_publico as a
  cross join parametros as p
  where a.activo is true
    and (
      a.codigo = any(p.codigos)
      or (
        p_portada
        and (a.oferta is true or a.destacado is true or a.mas_vendido is true or a.acceso_rapido is true)
      )
      or (
        p.termino <> ''
        and (
          extensions.unaccent(lower(coalesce(a.codigo, ''))) like p.termino || '%'
          or extensions.unaccent(lower(coalesce(a.codigo_proveedor, ''))) like '%' || p.termino || '%'
          or extensions.unaccent(lower(coalesce(a.nombre, ''))) like '%' || p.termino || '%'
          or extensions.unaccent(lower(coalesce(a.rubro, ''))) like '%' || p.termino || '%'
          or extensions.unaccent(lower(coalesce(a.tags_ocultos::text, ''))) like '%' || p.termino || '%'
        )
      )
    )
  order by
    case
      when a.codigo = any(p.codigos) then 0
      when extensions.unaccent(lower(coalesce(a.codigo, ''))) = p.termino then 1
      when extensions.unaccent(lower(coalesce(a.codigo_proveedor, ''))) = p.termino then 2
      when extensions.unaccent(lower(coalesce(a.nombre, ''))) like p.termino || '%' then 3
      when a.destacado is true then 4
      when a.mas_vendido is true then 5
      when a.oferta is true then 6
      else 7
    end,
    a.nombre,
    a.codigo
  limit (select limite from parametros);
$$;

revoke all on function public.buscar_catalogo_publico_reducido(text, text[], boolean, integer) from public;
grant execute on function public.buscar_catalogo_publico_reducido(text, text[], boolean, integer) to anon, authenticated;
