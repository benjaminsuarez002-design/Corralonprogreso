alter table public.catalogo_articulos_edicion add column promocion_texto text not null default '';

create or replace view public.catalogo_articulos_publico with (security_invoker=true) as
 SELECT b.codigo,
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
    GREATEST(COALESCE(b.sync_version, 0::bigint), COALESCE(e.sync_version, 0::bigint)) AS sync_version,
    b.source_file,
    b.activo,
    b.created_at,
    b.updated_at,
    COALESCE(e.detalle, ''::text) AS detalle,
    COALESCE(e.tags_ocultos, '[]'::jsonb) AS tags_ocultos,
    COALESCE(e.foto_url, ''::text) AS foto_url,
    COALESCE(e.imagenes, '[]'::jsonb) AS imagenes,
    COALESCE(e.oferta, false) AS oferta,
    COALESCE(e.oferta_pct, 0::numeric) AS oferta_pct,
    e.oferta_hasta,
    COALESCE(e.destacado, false) AS destacado,
    COALESCE(e.mas_vendido, false) AS mas_vendido,
    COALESCE(e.acceso_rapido, false) AS acceso_rapido,
    COALESCE(e.ceramico, false) AS ceramico,
    COALESCE(e.ceramico_m2, 0::numeric) AS ceramico_m2,
    COALESCE(e.ceramico_placas, 0) AS ceramico_placas,
    e.updated_by AS editado_por,
    e.updated_at AS edicion_updated_at,
    b.id_rubro,
    COALESCE(e.promocion_texto, '') AS promocion_texto
   FROM catalogo_articulos b
     LEFT JOIN catalogo_articulos_edicion e ON e.codigo = b.codigo;

CREATE OR REPLACE FUNCTION private.catalogo_registrar_cambio_edicion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  anterior jsonb := '{}'::jsonb;
  actual jsonb := '{}'::jsonb;
  parche jsonb := '{}'::jsonb;
  codigo_articulo text;
begin
  codigo_articulo := case when tg_op = 'DELETE' then old.codigo else new.codigo end;

  if tg_op = 'DELETE' then
    actual := jsonb_build_object(
      'detalle', '', 'tags_ocultos', '[]'::jsonb, 'foto_url', '', 'imagenes', '[]'::jsonb,
      'oferta', false, 'oferta_pct', 0, 'oferta_hasta', null, 'promocion_texto', '',
      'destacado', false, 'mas_vendido', false, 'acceso_rapido', false,
      'ceramico', false, 'ceramico_m2', 0, 'ceramico_placas', 0,
      'editado_por', null, 'edicion_updated_at', null
    );
  else
    actual := jsonb_build_object(
      'detalle', new.detalle,
      'tags_ocultos', new.tags_ocultos,
      'foto_url', new.foto_url,
      'imagenes', new.imagenes,
      'oferta', new.oferta,
      'oferta_pct', new.oferta_pct,
      'oferta_hasta', new.oferta_hasta,
      'promocion_texto', new.promocion_texto,
      'destacado', new.destacado,
      'mas_vendido', new.mas_vendido,
      'acceso_rapido', new.acceso_rapido,
      'ceramico', new.ceramico,
      'ceramico_m2', new.ceramico_m2,
      'ceramico_placas', new.ceramico_placas,
      'editado_por', new.updated_by,
      'edicion_updated_at', new.updated_at
    );
  end if;

  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    anterior := jsonb_build_object(
      'detalle', old.detalle,
      'tags_ocultos', old.tags_ocultos,
      'foto_url', old.foto_url,
      'imagenes', old.imagenes,
      'oferta', old.oferta,
      'oferta_pct', old.oferta_pct,
      'oferta_hasta', old.oferta_hasta,
      'promocion_texto', old.promocion_texto,
      'destacado', old.destacado,
      'mas_vendido', old.mas_vendido,
      'acceso_rapido', old.acceso_rapido,
      'ceramico', old.ceramico,
      'ceramico_m2', old.ceramico_m2,
      'ceramico_placas', old.ceramico_placas,
      'editado_por', old.updated_by,
      'edicion_updated_at', old.updated_at
    );
  end if;

  select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
    into parche
  from jsonb_each(actual) as item
  where (anterior -> item.key) is distinct from item.value;

  if parche <> '{}'::jsonb then
    insert into public.catalogo_articulos_cambios (codigo, cambios, eliminado, origen)
    values (codigo_articulo, parche, false, 'catalogo_articulos_edicion');
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$
;

drop function public.buscar_catalogo_publico_reducido(text,text[],boolean,integer);
CREATE OR REPLACE FUNCTION public.buscar_catalogo_publico_reducido(p_termino text DEFAULT ''::text, p_codigos text[] DEFAULT ARRAY[]::text[], p_portada boolean DEFAULT false, p_limite integer DEFAULT 400)
 RETURNS TABLE(codigo text, codigo_proveedor text, nombre text, rubro text, id_rubro integer, precio_venta numeric, stock numeric, stock_progreso numeric, stock_calle5 numeric, sync_version bigint, detalle text, tags_ocultos jsonb, foto_url text, imagenes jsonb, oferta boolean, oferta_pct numeric, oferta_hasta date, destacado boolean, mas_vendido boolean, acceso_rapido boolean, ceramico boolean, ceramico_m2 numeric, ceramico_placas integer, id_proveedor text, edicion_updated_at timestamp with time zone, promocion_texto text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
    a.ceramico_placas,
    a.id_proveedor,
    a.edicion_updated_at,
    a.promocion_texto
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
$function$
;
revoke all on function public.buscar_catalogo_publico_reducido(text,text[],boolean,integer) from public;
grant execute on function public.buscar_catalogo_publico_reducido(text,text[],boolean,integer) to anon,authenticated;
