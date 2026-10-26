alter table public.caja_publicaciones
  add column if not exists movimientos_version bigint not null default 0,
  add column if not exists ingresos_egresos_version bigint not null default 0,
  add column if not exists recibos_version bigint not null default 0,
  add column if not exists transferencias_version bigint not null default 0,
  add column if not exists movimientos_hash text not null default '',
  add column if not exists ingresos_egresos_hash text not null default '',
  add column if not exists recibos_hash text not null default '',
  add column if not exists transferencias_hash text not null default '';

alter table public.caja_transferencias_sistema
  add column if not exists idversion bigint not null default 0;

create index if not exists caja_transferencias_sistema_fecha_idversion_idx
  on public.caja_transferencias_sistema (fecha, idversion);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'caja_publicaciones'
  ) then
    alter publication supabase_realtime add table public.caja_publicaciones;
  end if;
end
$$;
