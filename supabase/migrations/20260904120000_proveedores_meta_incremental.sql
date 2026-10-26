create or replace function public.actualizar_proveedores_meta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nueva_version bigint := floor(extract(epoch from clock_timestamp()) * 1000000)::bigint;
  total_actual bigint;
begin
  select count(*) into total_actual from public.proveedores;
  insert into public.proveedores_meta (id, version, total_proveedores, updated_at)
  values ('principal', nueva_version, total_actual, now())
  on conflict (id) do update
  set version = greatest(public.proveedores_meta.version + 1, excluded.version),
      total_proveedores = excluded.total_proveedores,
      updated_at = excluded.updated_at;
  return null;
end;
$$;

revoke all on function public.actualizar_proveedores_meta() from public, anon, authenticated;

drop trigger if exists proveedores_actualizar_meta on public.proveedores;
create trigger proveedores_actualizar_meta
after insert or update or delete on public.proveedores
for each statement execute function public.actualizar_proveedores_meta();

update public.proveedores_meta
set version = greatest(version + 1, floor(extract(epoch from clock_timestamp()) * 1000000)::bigint),
    total_proveedores = (select count(*) from public.proveedores),
    updated_at = now()
where id = 'principal';
