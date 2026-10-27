-- Fase 2 de Locations (CLAUDE.md §16.11): brand_locations → locations (única fuente de ubicación).
-- Copia cada punto de venta como place de su marca (comuna resuelta por nombre dentro de Chile; sin inventar datos)
-- y deja un respaldo en ops. No borra brand_locations: la tabla se elimina en una migración posterior, ya verificada.
create schema if not exists ops;

create table if not exists ops.backup_brand_locations_20261028 as table public.brand_locations;

with src as (
  select bl.*, b.organization_id as brand_org,
    (select c.id from public.locations c
       where c.level = 'commune' and c.is_active
         and public.locations_norm(c.name) = public.locations_norm(bl.city)
       order by c.created_at limit 1) as commune_id
  from public.brand_locations bl
  join public.brands b on b.id = bl.brand_id
)
insert into public.locations (organization_id, brand_id, parent_id, level, type, name, address, is_private, notes, created_at, updated_at)
select s.brand_org, s.brand_id, s.commune_id, 'place',
       case s.location_type when 'store' then 'store' when 'event' then 'event' else 'other' end,
       s.name, s.address, not s.is_public, s.notes, s.created_at, s.updated_at
from src s
where s.brand_org is not null and s.commune_id is not null
  and not exists (
    select 1 from public.locations l
    where l.level = 'place' and l.brand_id = s.brand_id and l.name = s.name and l.address is not distinct from s.address
  );
