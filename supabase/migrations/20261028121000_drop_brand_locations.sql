-- brand_locations queda reemplazada por locations (20261028120000). Sin consumidores en código ni dependencias en la base.
-- Respaldo: ops.backup_brand_locations_20261028. Se verifica que cada fila esté copiada antes de eliminar.
do $$
declare v_missing int;
begin
  select count(*) into v_missing
  from public.brand_locations bl
  where not exists (
    select 1 from public.locations l
    where l.level = 'place' and l.brand_id = bl.brand_id and l.name = bl.name and l.address is not distinct from bl.address
  );
  if v_missing > 0 then
    raise exception 'brand_locations: % fila(s) sin copiar a locations; no se elimina la tabla', v_missing;
  end if;
end $$;

drop table public.brand_locations;
