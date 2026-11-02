-- Búsqueda del roster admin (/api/influencers) resuelta en Postgres, paginada y sin listas de ids en la URL.
-- Antes: la ruta calculaba en memoria TODAS las ubicaciones que contenían el término y las pasaba como
-- `location_id.in.(...)` en .or(); con términos cortos («a») la URL superaba el límite de PostgREST (500).
-- Ahora: `influencers.search_text` = nombre + país/región/ciudad/comuna, sin tildes y en minúsculas, mantenido por
-- triggers (alta/edición de la influencer y cambios de nombre/padre en `locations`), con índice trigram.
-- No contiene email (el email se filtra aparte): la columna puede viajar en select('*') sin exponer datos nuevos.
-- APLICADA SOLO EN DEV hasta autorización. Reversión: drop trigger/function/index y `alter table ... drop column search_text`.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.search_normalize(p text)
returns text language sql immutable parallel safe set search_path = public as $$
  select lower(translate(coalesce(p, ''),
    'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ',
    'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'));
$$;

-- Nombres de los ancestros geográficos (incluido el propio nodo) de una ubicación; nunca el nombre de un `place`.
create or replace function public.location_search_path(p_location_id uuid)
returns text language sql stable security definer set search_path = public as $$
  with recursive up as (
    select l.id, l.parent_id, l.name, l.level, 0 as depth from public.locations l where l.id = p_location_id
    union all
    select p.id, p.parent_id, p.name, p.level, up.depth + 1 from public.locations p join up on p.id = up.parent_id where up.depth < 6
  )
  select coalesce(string_agg(public.search_normalize(name), ' '), '')
  from up where level in ('country', 'region', 'city', 'commune');
$$;

alter table public.influencers add column if not exists search_text text not null default '';

create or replace function public.influencers_set_search_text()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.search_text := btrim(public.search_normalize(new.display_name) || ' ' || public.location_search_path(new.location_id));
  return new;
end;
$$;

drop trigger if exists trg_influencers_search_text on public.influencers;
create trigger trg_influencers_search_text
  before insert or update of display_name, location_id on public.influencers
  for each row execute function public.influencers_set_search_text();

-- Renombrar o mover un nodo geográfico refresca a las influencers de su subárbol (cambio raro, escala acotada).
create or replace function public.locations_refresh_influencer_search()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.influencers i
  set search_text = btrim(public.search_normalize(i.display_name) || ' ' || public.location_search_path(i.location_id))
  where i.location_id in (
    with recursive down as (
      select id from public.locations where id = new.id
      union all
      select c.id from public.locations c join down on c.parent_id = down.id
    )
    select id from down
  );
  return null;
end;
$$;

drop trigger if exists trg_locations_refresh_influencer_search on public.locations;
create trigger trg_locations_refresh_influencer_search
  after update of name, parent_id on public.locations
  for each row execute function public.locations_refresh_influencer_search();

revoke all on function public.influencers_set_search_text() from public, anon, authenticated;
revoke all on function public.locations_refresh_influencer_search() from public, anon, authenticated;
revoke all on function public.location_search_path(uuid) from public, anon, authenticated;

-- Relleno inicial directo (no toca display_name ni location_id: no dispara otros triggers ni cambia updated_at).
update public.influencers
set search_text = btrim(public.search_normalize(display_name) || ' ' || public.location_search_path(location_id));

create index if not exists influencers_search_text_trgm
  on public.influencers using gin (search_text extensions.gin_trgm_ops);
